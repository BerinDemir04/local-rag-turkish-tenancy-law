/**
 * Turkish legal document chunking and lexical retrieval utilities.
 *
 * Main goals:
 * - Preserve Turkish characters
 * - Split TBK text by article (MADDE) boundaries
 * - Preserve legal headings together with the article they describe
 * - Produce TF-IDF compatible lexical vectors
 */


/**
 * Parse simple YAML-like front matter.
 */
export function parseFrontMatter(text) {
  const match = text.match(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
  );

  if (!match) {
    return {
      meta: {},
      body: text,
    };
  }

  const meta = {};

  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");

    if (idx > 0) {
      meta[
        line.slice(0, idx).trim()
      ] =
        line
          .slice(idx + 1)
          .trim();
    }
  }

  return {
    meta,
    body: match[2],
  };
}


/**
 * Generic fallback word-based splitting.
 */
function splitByWordCount(
  text,
  maxTokens,
  overlapTokens
) {
  const words =
    String(text ?? "")
      .split(/\s+/)
      .filter(Boolean);

  if (words.length === 0) {
    return [];
  }

  if (words.length <= maxTokens) {
    return [
      text.trim()
    ];
  }

  const chunks = [];
  let start = 0;

  while (start < words.length) {
    const end =
      Math.min(
        start + maxTokens,
        words.length
      );

    chunks.push(
      words
        .slice(start, end)
        .join(" ")
        .trim()
    );

    if (end >= words.length) {
      break;
    }

    start =
      Math.max(
        0,
        end - overlapTokens
      );
  }

  return chunks;
}


/**
 * Determine whether a line looks like a legal section heading.
 *
 * Examples:
 *
 * ## IV. Kiralananın kullanılmaması
 * ## 2. Kiralananın sözleşmenin bitiminden önce geri verilmesi
 * **III. Olağanüstü fesih**
 * D. Kiracının güvence vermesi
 */
function isHeadingLine(line) {
  const value =
    String(line ?? "")
      .trim();

  if (!value) {
    return false;
  }

  // Markdown headings.
  if (/^#{1,6}\s+/.test(value)) {
    return true;
  }

  // Fully bolded markdown heading.
  if (
    /^\*\*[^*]+\*\*(?:\[[^\]]+\])?$/.test(
      value
    )
  ) {
    return true;
  }

  /**
   * Short numbered / lettered headings.
   *
   * Avoid classifying normal article paragraphs
   * as headings by limiting the length.
   */
  if (
    value.length <= 140 &&
    /^(?:[A-ZÇĞİÖŞÜ]\.|[IVXLCDM]+\.)\s+/u.test(
      value.replace(/\*\*/g, "")
    )
  ) {
    return true;
  }

  if (
    value.length <= 140 &&
    /^\d+\.\s+/u.test(
      value.replace(/\*\*/g, "")
    )
  ) {
    return true;
  }

  if (
    value.length <= 140 &&
    /^[a-zçğıöşü]\.\s+/u.test(
      value.replace(/\*\*/g, "")
    )
  ) {
    return true;
  }

  return false;
}


/**
 * Clean a heading for retrieval while preserving its meaning.
 */
function cleanHeading(line) {
  return String(line ?? "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .replace(
      /\[[^\]]+\]/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}


/**
 * Split a Turkish legal document article by article.
 *
 * Unlike the earlier version, headings immediately preceding
 * each MADDE are preserved with that article.
 */
function splitByArticles(text) {
  const lines =
    String(text ?? "")
      .split(/\r?\n/);

  const chunks = [];

  let pendingHeadings = [];
  let currentArticle = null;


  const flushCurrentArticle = () => {
    if (!currentArticle) {
      return;
    }

    const body =
      currentArticle.lines
        .join("\n")
        .trim();

    if (body) {
      const headings =
        currentArticle.headings
          .filter(Boolean);

      const enrichedText =
        headings.length > 0
          ? [
              `KONU: ${headings.join(" > ")}`,
              body,
            ].join("\n")
          : body;

      chunks.push(
        enrichedText
      );
    }

    currentArticle = null;
  };


  for (const rawLine of lines) {
    const line =
      String(rawLine ?? "");

    const trimmed =
      line.trim();


    /**
     * New article starts here.
     */
    if (
      /\bMADDE\s+\d+\s*[-–—]/iu.test(
        trimmed
      )
    ) {
      flushCurrentArticle();

      currentArticle = {
        headings:
          [...pendingHeadings],

        lines: [
          trimmed
        ],
      };

      pendingHeadings = [];

      continue;
    }


    /**
     * A heading encountered AFTER an article belongs
     * to the NEXT article rather than the previous one.
     */
    if (isHeadingLine(trimmed)) {
      const cleaned =
        cleanHeading(
          trimmed
        );

      if (cleaned) {
        pendingHeadings.push(
          cleaned
        );
      }

      continue;
    }


    /**
     * Normal paragraph.
     */
    if (currentArticle) {
      /**
       * If headings were collected but normal text appears
       * before the next MADDE, those headings were probably
       * not article headings after all.
       *
       * Preserve them inside the current article.
       */
      if (
        pendingHeadings.length > 0 &&
        trimmed
      ) {
        currentArticle.lines.push(
          ...pendingHeadings
        );

        pendingHeadings = [];
      }

      if (trimmed) {
        currentArticle.lines.push(
          trimmed
        );
      }
    }
  }


  flushCurrentArticle();

  return chunks;
}


/**
 * Main chunk function.
 */
export function chunkText(
  text,
  maxTokens = 800,
  overlapTokens = 100
) {
  const cleaned =
    String(text ?? "")
      .trim();

  if (!cleaned) {
    return [];
  }

  const articleChunks =
    splitByArticles(
      cleaned
    );

  if (articleChunks.length > 0) {
    const finalChunks = [];

    for (const article of articleChunks) {
      finalChunks.push(
        ...splitByWordCount(
          article,
          maxTokens,
          overlapTokens
        )
      );
    }

    return finalChunks;
  }

  return splitByWordCount(
    cleaned,
    maxTokens,
    overlapTokens
  );
}


/**
 * Common Turkish stop words.
 */
const STOP_WORDS = new Set([
  "acaba",
  "ama",
  "ancak",
  "artık",
  "aslında",
  "bana",
  "bazı",
  "belki",
  "ben",
  "beni",
  "benim",
  "beri",
  "bile",
  "bir",
  "biri",
  "biz",
  "bize",
  "bizim",
  "bu",
  "bunu",
  "bunun",
  "böyle",
  "da",
  "daha",
  "de",
  "diye",
  "en",
  "fakat",
  "gibi",
  "hem",
  "hep",
  "her",
  "için",
  "ile",
  "ise",
  "ki",
  "mı",
  "mi",
  "mu",
  "mü",
  "nasıl",
  "ne",
  "neden",
  "niye",
  "o",
  "olan",
  "olarak",
  "oldu",
  "olur",
  "onu",
  "onun",
  "orada",
  "şey",
  "şimdi",
  "şu",
  "ve",
  "veya",
  "ya",
  "yani"
]);


/**
 * Turkish-aware normalization.
 */
export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFC")
    .toLocaleLowerCase(
      "tr-TR"
    )
    .replace(
      /[’‘`´]/g,
      "'"
    )
    .replace(
      /[–—]/g,
      "-"
    )
    .replace(
      /[^\p{L}\p{N}'-]+/gu,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


/**
 * Turkish-aware tokenization.
 */
export function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .map(
      (token) =>
        token
          .replace(
            /^[-']+|[-']+$/g,
            ""
          )
          .trim()
    )
    .filter(
      (token) =>
        token.length > 1 &&
        !STOP_WORDS.has(
          token
        )
    );
}


/**
 * Term-frequency map.
 */
export function termFrequency(text) {
  const tf =
    new Map();

  for (
    const token
    of tokenize(text)
  ) {
    tf.set(
      token,
      (tf.get(token) || 0) + 1
    );
  }

  return tf;
}


/**
 * Apply IDF weighting.
 */
export function applyIdf(
  tf,
  idfMap
) {
  const weighted =
    new Map();

  for (
    const [term, freq]
    of tf
  ) {
    const idf =
      idfMap.get(term) ?? 1;

    const tfWeight =
      1 + Math.log(freq);

    weighted.set(
      term,
      tfWeight * idf
    );
  }

  return weighted;
}


/**
 * Sparse cosine similarity.
 */
export function cosineSimilarity(
  a,
  b
) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (
    const [term, value]
    of a
  ) {
    normA +=
      value * value;

    if (b.has(term)) {
      dot +=
        value * b.get(term);
    }
  }

  for (
    const [, value]
    of b
  ) {
    normB +=
      value * value;
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