# Turkish Tenancy Law – Local RAG Assistant

An offline Retrieval-Augmented Generation (RAG) assistant designed to answer questions about Turkish tenancy law using selected provisions of the Turkish Code of Obligations (Türk Borçlar Kanunu – TBK).

This project was developed by adapting a local RAG starter project to a Turkish legal question-answering use case. The system focuses on local processing, semantic retrieval, legal article selection, and grounded answer generation.

## Overview

The application allows users to ask natural-language questions in Turkish about tenancy law.

For each question, the system:

1. Processes and expands the user's legal query.
2. Creates a semantic embedding using `multilingual-e5-small`.
3. Retrieves relevant legal provisions from a local SQLite knowledge base.
4. Ranks relevant sentences and selects the most appropriate TBK article.
5. Builds a focused legal context from the selected article.
6. Attempts to generate an answer using `Phi-4-mini` through Foundry Local.
7. Validates the generated answer against the retrieved legal source.
8. Uses a source-grounded fallback if the generated answer does not satisfy the validation rules.

The system is designed to operate locally without sending legal documents or user queries to external AI services.

## RAG Pipeline

```text
User Question
      |
      v
Query Processing / Expansion
      |
      v
Multilingual E5 Embedding
      |
      v
Hybrid Retrieval
(SQLite Knowledge Base)
      |
      v
Sentence Ranking
      |
      v
Relevant TBK Article Selection
      |
      v
Focused Legal Context
      |
      v
Phi-4-mini
(Foundry Local)
      |
      v
Answer Validation
   /             \
Accepted        Rejected
   |               |
   v               v
LLM Answer    Source-Grounded
                 Fallback
Technologies
JavaScript
Node.js
Foundry Local
Phi-4-mini
Transformers.js
Xenova/multilingual-e5-small
SQLite
better-sqlite3
HTML / CSS / JavaScript
Knowledge Base
The current knowledge base contains selected tenancy provisions of the Turkish Code of Obligations (TBK).
The legal documents are stored locally in the docs/ directory and are processed into article-aware chunks during ingestion.
The current dataset produces 58 legal article chunks.
Retrieval
The retrieval pipeline combines semantic and lexical information.
Semantic similarity is calculated using multilingual E5 embeddings. Retrieved legal content is further processed using sentence-level ranking and intent-based article selection.
This helps distinguish between legally related but different concepts, such as:
transfer of the lease relationship,
subleasing,
payment time,
late-payment penalties,
change of property ownership,
landlord necessity,
re-letting restrictions.
Answer Validation
Small local language models can occasionally generate repetitive, incomplete, or insufficiently grounded answers.
For this reason, generated answers are checked before being returned to the user.
The validation layer checks factors such as:
grounding in the selected legal article,
overlap with the focused legal context,
repetition,
incomplete generation,
suspicious prompt-like language,
unsupported article references or legal details.
If the generated response fails validation, the application returns a deterministic answer directly grounded in the selected legal provision.
This design prioritizes legal grounding and reliability over unrestricted generation.
Example Questions
Examples of questions supported by the current knowledge base include:
Ev sahibinin izni olmadan kira sözleşmesini başka birine devredebilir miyim?
Relevant provision: TBK Article 323
Ev sahibi ihtiyaç nedeniyle beni çıkardıktan hemen sonra evi başka birine kiralayabilir mi?
Relevant provision: TBK Article 355
Kira bedelini normalde ne zaman ödemem gerekir?
Relevant provision: TBK Article 314
Ev sahibi kirayı zamanında ödemediğim için sözleşmeye ayrıca ceza koyabilir mi?
Relevant provision: TBK Article 346
Kira sözleşmesi devam ederken ev satılırsa kira sözleşmem sona erer mi?
Relevant provision: TBK Article 310
Running the Project
Requirements
Node.js 22
Foundry Local
A locally available phi-4-mini model
Install the project dependencies:
npm install
Build the local RAG database:
npm run ingest
Start the application:
npm start
Then open:
http://127.0.0.1:3000
Privacy and Local Execution
The application is designed for local execution.
Legal documents, embeddings, retrieval, and LLM inference are processed locally. The application does not require sending the user's legal questions or the knowledge base to an external LLM API.
Project Scope
This project is a prototype focused on demonstrating a local RAG architecture for Turkish tenancy law.
It is not intended to provide professional legal advice. Its answers are limited to the legal provisions included in the local knowledge base.
Development
The project was developed from a local RAG starter codebase and adapted for Turkish legal information retrieval.
Major development work included:
replacing the original knowledge domain with Turkish tenancy law,
article-aware legal document chunking,
Turkish-compatible text processing,
multilingual semantic embeddings,
hybrid retrieval,
query normalization and legal intent handling,
sentence-level semantic ranking,
legal article selection,
Foundry Local / Phi-4-mini answer generation,
answer quality validation,
source-grounded fallback generation,
offline web interface integration.
During development, several approaches were tested and refined. Follow-up question handling and simplified answer styles were explored, but these introduced reliability issues with the small local language model. The final version therefore prioritizes retrieval accuracy, source grounding, and validated answer generation.
Author
Berin Demir
Industrial Engineering & Computer Engineering
Kadir Has University