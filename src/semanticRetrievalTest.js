/**
 * Semantic retrieval evaluation.
 *
 * This script does NOT modify rag.db.
 *
 * It:
 * 1. Reads the real TBK documents
 * 2. Splits them into MADDE-based chunks
 * 3. Embeds every article locally
 * 4. Embeds several test questions
 * 5. Prints the top-5 matching TBK articles
 */

import fs from "fs";
import path from "path";

import {
  pipeline
} from "@huggingface/transformers";

import {
  config
} from "./config.js";

import {
  parseFrontMatter,
  chunkText
} from "./chunker.js";


const MODEL =
  "Xenova/multilingual-e5-small";


console.log(
  "=== Semantic Retrieval Test ===\n"
);


console.log(
  `Embedding modeli yükleniyor: ${MODEL}`
);


const extractor =
  await pipeline(
    "feature-extraction",
    MODEL
  );


console.log(
  "Embedding modeli hazır.\n"
);


/**
 * Create an E5 embedding.
 *
 * E5 models work best with:
 *
 * query: ...
 * passage: ...
 */
async function embedQuery(text) {
  const output =
    await extractor(
      `query: ${text}`,
      {
        pooling: "mean",
        normalize: true,
      }
    );

  return Array.from(
    output.data
  );
}


async function embedPassage(text) {
  const output =
    await extractor(
      `passage: ${text}`,
      {
        pooling: "mean",
        normalize: true,
      }
    );

  return Array.from(
    output.data
  );
}


/**
 * Since vectors are normalized,
 * dot product is effectively cosine similarity.
 */
function cosineSimilarity(
  a,
  b
) {
  let dot = 0;

  const length =
    Math.min(
      a.length,
      b.length
    );

  for (
    let i = 0;
    i < length;
    i++
  ) {
    dot +=
      a[i] * b[i];
  }

  return dot;
}


/**
 * Extract TBK article number.
 */
function getArticleNumber(text) {
  const match =
    String(text ?? "")
      .match(
        /\bMADDE\s+(\d+)/iu
      );

  return match
    ? Number(match[1])
    : null;
}


/**
 * Read all Markdown documents and create
 * the same MADDE-based chunks used by the RAG system.
 */
const files =
  fs
    .readdirSync(
      config.docsDir
    )
    .filter(
      (file) =>
        file.endsWith(".md")
    )
    .sort();


const articles = [];


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
    body
  } =
    parseFrontMatter(
      raw
    );


  const chunks =
    chunkText(
      body,
      config.chunkSize,
      config.chunkOverlap
    );


  for (const chunk of chunks) {
    const articleNumber =
      getArticleNumber(
        chunk
      );


    articles.push({
      articleNumber,
      source:
        file,
      text:
        chunk,
      embedding:
        null,
    });
  }
}


console.log(
  `${articles.length} TBK maddesi bulundu.`
);


console.log(
  "Maddelerin embeddingleri oluşturuluyor..."
);


/**
 * Embed all articles once.
 */
for (
  let i = 0;
  i < articles.length;
  i++
) {
  articles[i].embedding =
    await embedPassage(
      articles[i].text
    );


  process.stdout.write(
    `\r${i + 1}/${articles.length}`
  );
}


console.log(
  "\n\nEmbeddingler hazır.\n"
);


/**
 * Test cases.
 *
 * expected is NOT used to manipulate ranking.
 * It is shown only so we can visually evaluate
 * whether retrieval works.
 */
const TESTS = [
  {
    question:
      "Depozitomu ev sahibi geri vermiyor, ne yapabilirim?",
    expected:
      [342],
  },

  {
    question:
      "Sözleşmem bitmeden evden çıkarsam kalan kiraları ödemek zorunda mıyım?",
    expected:
      [325],
  },

  {
    question:
      "Evden erken ayrılırsam yerime yeni bir kiracı bulmam borcumu sona erdirir mi?",
    expected:
      [325],
  },

  {
    question:
      "Ev sahibim kiraya çok fazla zam yapmak istiyor, kira artışı nasıl belirlenir?",
    expected:
      [344],
  },

  {
    question:
      "Ev sahibi sadece sözleşmenin süresi bitti diye beni evden çıkarabilir mi?",
    expected:
      [347],
  },

  {
    question:
      "Ev sahibi evi kendisi kullanacağını söylüyor ve çıkmamı istiyor.",
    expected:
      [350],
  },

  {
    question:
      "Kirayı ödemediğim için ev sahibi sözleşmeyi feshedebilir mi?",
    expected:
      [315],
  },

  /**
   * Direct/legal-language controls.
   *
   * If these fail, semantic retrieval itself
   * has a serious problem.
   */
  {
    question:
      "Kiracının güvence vermesi nasıl düzenlenmiştir?",
    expected:
      [342],
  },

  {
    question:
      "Kiralananın sözleşmenin bitiminden önce geri verilmesi",
    expected:
      [325],
  },

  {
    question:
      "Kira bedelinin yenilenen dönemde belirlenmesi",
    expected:
      [344],
  },
];


/**
 * Run every query against all 58 embeddings.
 */
for (const test of TESTS) {
  const queryEmbedding =
    await embedQuery(
      test.question
    );


  const ranked =
    articles
      .map(
        (article) => ({
          ...article,

          score:
            cosineSimilarity(
              queryEmbedding,
              article.embedding
            ),
        })
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      );


  const top5 =
    ranked.slice(
      0,
      5
    );


  const topArticles =
    top5.map(
      (item) =>
        item.articleNumber
    );


  const hit =
    test.expected.some(
      (expectedArticle) =>
        topArticles.includes(
          expectedArticle
        )
    );


  console.log(
    "============================================================"
  );


  console.log(
    `SORU: ${test.question}`
  );


  console.log(
    `BEKLENEN MADDE: ${test.expected.join(", ")}`
  );


  console.log(
    `TOP 5: ${
      topArticles.join(", ")
    }`
  );


  console.log(
    hit
      ? "✅ Beklenen madde TOP 5 içinde."
      : "❌ Beklenen madde TOP 5 içinde değil."
  );


  console.log(
    "\nSıralama:"
  );


  top5.forEach(
    (item, index) => {
      console.log(
        `${index + 1}. MADDE ${item.articleNumber} | ${item.score.toFixed(4)} | ${item.source}`
      );
    }
  );


  console.log("");
}


await extractor.dispose();


console.log(
  "============================================================"
);


console.log(
  "Semantic retrieval testi tamamlandı."
); 