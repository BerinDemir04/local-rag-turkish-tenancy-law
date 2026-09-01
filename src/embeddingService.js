/**
 * Local embedding service.
 *
 * Uses multilingual-e5-small through Transformers.js.
 *
 * The model is downloaded once and then cached locally.
 * Runtime retrieval works fully offline.
 */

import {
  pipeline
} from "@huggingface/transformers";


export class EmbeddingService {
  constructor(
    modelName =
      "Xenova/multilingual-e5-small"
  ) {
    this.modelName =
      modelName;

    this.extractor =
      null;
  }


  async init() {
    if (this.extractor) {
      return;
    }

    console.log(
      `[Embedding] Model yükleniyor: ${this.modelName}`
    );

    this.extractor =
      await pipeline(
        "feature-extraction",
        this.modelName
      );

    console.log(
      "[Embedding] Model hazır."
    );
  }


  async embedQuery(text) {
    await this.init();

    const output =
      await this.extractor(
        `query: ${String(text ?? "").trim()}`,
        {
          pooling: "mean",
          normalize: true,
        }
      );

    return Array.from(
      output.data
    );
  }


  async embedPassage(text) {
    await this.init();

    const output =
      await this.extractor(
        `passage: ${String(text ?? "").trim()}`,
        {
          pooling: "mean",
          normalize: true,
        }
      );

    return Array.from(
      output.data
    );
  }


  async close() {
    if (!this.extractor) {
      return;
    }

    try {
      await this.extractor.dispose();
    } catch (err) {
      console.error(
        "[Embedding] Model dispose error:",
        err
      );
    }

    this.extractor =
      null;
  }
}