// Application configuration – all paths relative to project root

import {
  fileURLToPath
} from "url";

import path from "path";


const __dirname =
  path.dirname(
    fileURLToPath(
      import.meta.url
    )
  );


const ROOT =
  path.resolve(
    __dirname,
    ".."
  );


export const config = {
  // Foundry Local chat model
  model:
    "phi-4-mini",


  // Local embedding model
  embeddingModel:
    "Xenova/multilingual-e5-small",


  // Documents / database
  docsDir:
    path.join(
      ROOT,
      "docs"
    ),

  dbPath:
    path.join(
      ROOT,
      "data",
      "rag.db"
    ),


  // Legal article chunking
  chunkSize:
    800,

  chunkOverlap:
    100,


  /**
   * Number of retrieved legal articles that continue
   * to sentence-level reranking.
   *
   * Phi does NOT receive all 5 articles.
   * The reranking stage selects one final article first.
   */
  topK:
    5,


  /**
   * Hybrid retrieval candidate pools.
   */
  semanticK:
    12,

  lexicalK:
    12,


  // Hybrid ranking weights
  semanticWeight:
    1.0,

  lexicalWeight:
    0.65,


  // Server
  port:
    3000,

  host:
    "127.0.0.1",


  // UI
  publicDir:
    path.join(
      ROOT,
      "public"
    ),
};