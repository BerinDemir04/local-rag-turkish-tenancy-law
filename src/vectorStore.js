/**
 * Hybrid local RAG store backed by SQLite.
 *
 * Stores:
 * - legal article text
 * - TF vectors
 * - semantic embedding vectors
 *
 * Retrieval:
 * - TF-IDF lexical search
 * - embedding cosine similarity
 * - Reciprocal Rank Fusion
 */

import Database
  from "better-sqlite3";

import path
  from "path";

import fs
  from "fs";

import {
  termFrequency,
  applyIdf,
  cosineSimilarity as sparseCosineSimilarity,
} from "./chunker.js";


function denseCosineSimilarity(
  a,
  b
) {
  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    a.length === 0 ||
    a.length !== b.length
  ) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    dot +=
      a[i] * b[i];

    normA +=
      a[i] * a[i];

    normB +=
      b[i] * b[i];
  }

  if (
    normA === 0 ||
    normB === 0
  ) {
    return 0;
  }

  return (
    dot /
    (
      Math.sqrt(normA) *
      Math.sqrt(normB)
    )
  );
}


export class VectorStore {
  constructor(dbPath) {
    const dir =
      path.dirname(
        dbPath
      );

    if (
      !fs.existsSync(dir)
    ) {
      fs.mkdirSync(
        dir,
        {
          recursive: true
        }
      );
    }

    this.db =
      new Database(
        dbPath
      );

    this.db.pragma(
      "journal_mode = WAL"
    );

    this._init();

    this._rowCache =
      null;

    this._invertedIndex =
      null;

    this._idf =
      null;
  }


  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT NOT NULL,
        title TEXT,
        category TEXT,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        tf_json TEXT NOT NULL,
        embedding_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_doc_id
      ON chunks(doc_id);
    `);


    /**
     * Existing rag.db databases created before
     * embeddings existed may not have this column.
     */
    const columns =
      this.db
        .prepare(
          "PRAGMA table_info(chunks)"
        )
        .all();


    const hasEmbeddingColumn =
      columns.some(
        (column) =>
          column.name ===
          "embedding_json"
      );


    if (!hasEmbeddingColumn) {
      this.db.exec(`
        ALTER TABLE chunks
        ADD COLUMN embedding_json TEXT
      `);
    }


    this._stmtInsert =
      this.db.prepare(`
        INSERT INTO chunks (
          doc_id,
          title,
          category,
          chunk_index,
          content,
          tf_json,
          embedding_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);


    this._stmtAll =
      this.db.prepare(
        "SELECT * FROM chunks"
      );


    this._stmtCount =
      this.db.prepare(
        "SELECT COUNT(*) as cnt FROM chunks"
      );


    this._stmtListDocs =
      this.db.prepare(`
        SELECT
          doc_id,
          title,
          category,
          COUNT(*) as chunks
        FROM chunks
        GROUP BY doc_id
        ORDER BY title
      `);


    this._stmtDeleteDoc =
      this.db.prepare(
        "DELETE FROM chunks WHERE doc_id = ?"
      );
  }


  _invalidateCache() {
    this._rowCache =
      null;

    this._invertedIndex =
      null;

    this._idf =
      null;
  }


  _ensureCache() {
    if (this._rowCache) {
      return;
    }


    const rows =
      this._stmtAll.all();


    this._rowCache =
      rows.map(
        (row) => ({
          id:
            row.id,

          doc_id:
            row.doc_id,

          title:
            row.title,

          category:
            row.category,

          chunk_index:
            row.chunk_index,

          content:
            row.content,

          tf:
            new Map(
              JSON.parse(
                row.tf_json
              )
            ),

          embedding:
            row.embedding_json
              ? JSON.parse(
                  row.embedding_json
                )
              : null,
        })
      );


    this._invertedIndex =
      new Map();


    for (
      let rowIndex = 0;
      rowIndex <
        this._rowCache.length;
      rowIndex++
    ) {
      const row =
        this._rowCache[
          rowIndex
        ];

      for (
        const term
        of row.tf.keys()
      ) {
        if (
          !this._invertedIndex.has(
            term
          )
        ) {
          this._invertedIndex.set(
            term,
            new Set()
          );
        }

        this._invertedIndex
          .get(term)
          .add(rowIndex);
      }
    }


    this._idf =
      new Map();


    const documentCount =
      this._rowCache.length;


    for (
      const [
        term,
        indices
      ]
      of this._invertedIndex
    ) {
      const documentFrequency =
        indices.size;

      const idf =
        Math.log(
          (documentCount + 1) /
          (documentFrequency + 1)
        ) + 1;

      this._idf.set(
        term,
        idf
      );
    }
  }


  clear() {
    this.db.exec(
      "DELETE FROM chunks"
    );

    this._invalidateCache();
  }


  insert(
    docId,
    title,
    category,
    chunkIndex,
    content,
    embedding
  ) {
    const tf =
      termFrequency(
        content
      );

    const tfJson =
      JSON.stringify(
        [...tf]
      );

    const embeddingJson =
      JSON.stringify(
        embedding
      );


    this._stmtInsert.run(
      docId,
      title,
      category,
      chunkIndex,
      content,
      tfJson,
      embeddingJson
    );


    this._invalidateCache();
  }


  /**
   * Lexical TF-IDF search.
   */
  searchLexical(
    query,
    topK = 10
  ) {
    this._ensureCache();


    const queryTf =
      termFrequency(
        query
      );


    if (
      queryTf.size === 0
    ) {
      return [];
    }


    const candidateIndices =
      new Set();


    for (
      const term
      of queryTf.keys()
    ) {
      const indices =
        this._invertedIndex.get(
          term
        );

      if (!indices) {
        continue;
      }

      for (
        const index
        of indices
      ) {
        candidateIndices.add(
          index
        );
      }
    }


    const weightedQuery =
      applyIdf(
        queryTf,
        this._idf
      );


    const scored = [];


    for (
      const index
      of candidateIndices
    ) {
      const row =
        this._rowCache[
          index
        ];


      const weightedDocument =
        applyIdf(
          row.tf,
          this._idf
        );


      const score =
        sparseCosineSimilarity(
          weightedQuery,
          weightedDocument
        );


      if (score <= 0) {
        continue;
      }


      scored.push({
        ...row,
        tf:
          undefined,
        embedding:
          undefined,
        lexicalScore:
          score,
        score,
      });
    }


    scored.sort(
      (a, b) =>
        b.lexicalScore -
        a.lexicalScore
    );


    return scored.slice(
      0,
      topK
    );
  }


  /**
   * Semantic embedding search.
   */
  searchSemantic(
    queryEmbedding,
    topK = 10
  ) {
    this._ensureCache();


    const scored = [];


    for (
      const row
      of this._rowCache
    ) {
      if (
        !Array.isArray(
          row.embedding
        )
      ) {
        continue;
      }


      const score =
        denseCosineSimilarity(
          queryEmbedding,
          row.embedding
        );


      scored.push({
        ...row,
        tf:
          undefined,
        embedding:
          undefined,
        semanticScore:
          score,
        score,
      });
    }


    scored.sort(
      (a, b) =>
        b.semanticScore -
        a.semanticScore
    );


    return scored.slice(
      0,
      topK
    );
  }


  /**
   * Hybrid retrieval using weighted Reciprocal Rank Fusion.
   */
  searchHybrid(
    query,
    queryEmbedding,
    {
      topK = 5,
      semanticK = 12,
      lexicalK = 12,
      semanticWeight = 1.0,
      lexicalWeight = 0.65,
    } = {}
  ) {
    const semanticResults =
      this.searchSemantic(
        queryEmbedding,
        semanticK
      );


    const lexicalResults =
      this.searchLexical(
        query,
        lexicalK
      );


    const merged =
      new Map();


    const addResult = (
      row,
      rank,
      type,
      weight
    ) => {
      const key =
        row.id;


      if (
        !merged.has(key)
      ) {
        merged.set(
          key,
          {
            ...row,

            hybridScore:
              0,

            semanticScore:
              null,

            lexicalScore:
              null,

            matchedBy: [],
          }
        );
      }


      const current =
        merged.get(key);


      current.hybridScore +=
        weight /
        (60 + rank);


      current.matchedBy.push(
        type
      );


      if (
        type ===
        "semantic"
      ) {
        current.semanticScore =
          row.semanticScore;
      }


      if (
        type ===
        "lexical"
      ) {
        current.lexicalScore =
          row.lexicalScore;
      }
    };


    semanticResults.forEach(
      (row, index) => {
        addResult(
          row,
          index + 1,
          "semantic",
          semanticWeight
        );
      }
    );


    lexicalResults.forEach(
      (row, index) => {
        addResult(
          row,
          index + 1,
          "lexical",
          lexicalWeight
        );
      }
    );


    return [
      ...merged.values()
    ]
      .sort(
        (a, b) =>
          b.hybridScore -
          a.hybridScore
      )
      .slice(
        0,
        topK
      )
      .map(
        (row) => ({
          ...row,

          /**
           * UI still expects a generic score.
           */
          score:
            row.semanticScore ??
            row.lexicalScore ??
            0,
        })
      );
  }


  removeByDocId(
    docId
  ) {
    this
      ._stmtDeleteDoc
      .run(
        docId
      );

    this._invalidateCache();
  }


  count() {
    return (
      this._stmtCount
        .get()
        .cnt
    );
  }


  listDocs() {
    return (
      this._stmtListDocs
        .all()
    );
  }


  close() {
    this.db.close();
  }
}