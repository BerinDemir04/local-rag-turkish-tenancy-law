/**
 * Document ingestion pipeline.
 *
 * Steps:
 *
 * Markdown documents
 *      ↓
 * MADDE-based chunks
 *      ↓
 * Local E5 embeddings
 *      ↓
 * SQLite
 */

import fs
  from "fs";

import path
  from "path";

import {
  config
} from "./config.js";

import {
  parseFrontMatter,
  chunkText
} from "./chunker.js";

import {
  VectorStore
} from "./vectorStore.js";

import {
  EmbeddingService
} from "./embeddingService.js";


console.log(
  "=== Gas Field RAG – Semantic Document Ingestion ===\n"
);


const store =
  new VectorStore(
    config.dbPath
  );


const embeddingService =
  new EmbeddingService(
    config.embeddingModel
  );


try {
  await embeddingService.init();


  const files =
    fs
      .readdirSync(
        config.docsDir
      )
      .filter(
        (file) =>
          file.endsWith(".md") ||
          file.endsWith(".txt")
      )
      .sort();


  console.log(
    `Found ${files.length} documents.\n`
  );


  /**
   * Fresh rebuild.
   */
  store.clear();


  let totalChunks = 0;


  for (const file of files) {
    const filePath =
      path.join(
        config.docsDir,
        file
      );


    const raw =
      fs.readFileSync(
        filePath,
        "utf-8"
      );


    const {
      meta,
      body
    } =
      parseFrontMatter(
        raw
      );


    const docId =
      meta.id ||
      path.basename(
        file,
        path.extname(file)
      );


    const title =
      meta.title ||
      file;


    const category =
      meta.category ||
      "Uncategorised";


    const chunks =
      chunkText(
        body,
        config.chunkSize,
        config.chunkOverlap
      );


    for (
      let i = 0;
      i < chunks.length;
      i++
    ) {
      const embedding =
        await embeddingService.embedPassage(
          chunks[i]
        );


      store.insert(
        docId,
        title,
        category,
        i,
        chunks[i],
        embedding
      );


      totalChunks++;


      process.stdout.write(
        `\rEmbedding chunk ${totalChunks}`
      );
    }


    console.log(
      `\n  ✓ ${file} → ${chunks.length} chunk(s) [${category}]`
    );


    /**
     * Small pause between files.
     */
    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          100
        )
    );
  }


  console.log(
    `\nIngestion complete: ${totalChunks} chunks from ${files.length} documents.`
  );


  console.log(
    `Database: ${config.dbPath}`
  );

} catch (err) {
  console.error(
    "\nIngestion failed:",
    err
  );

  process.exitCode =
    1;

} finally {
  await embeddingService.close();

  store.close();
}