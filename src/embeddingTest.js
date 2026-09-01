import {
  pipeline
} from "@huggingface/transformers";


console.log(
  "=== Local Embedding Test ==="
);


const MODEL =
  "Xenova/multilingual-e5-small";


console.log(
  `Embedding modeli yükleniyor: ${MODEL}`
);


const extractor =
  await pipeline(
    "feature-extraction",
    MODEL
  );


console.log(
  "Embedding modeli hazır."
);


async function embed(text) {
  const output =
    await extractor(
      text,
      {
        pooling: "mean",
        normalize: true,
      }
    );

  return Array.from(
    output.data
  );
}


function cosineSimilarity(
  a,
  b
) {
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


const query =
  "Depozitomu ev sahibi geri vermiyor";


const article342 =
  `
Konut ve çatılı işyeri kiralarında
kiracıya güvence verme borcu getirilmişse
bu güvence üç aylık kira bedelini aşamaz.
Güvence olarak para verilmesi kararlaştırılmışsa
belirli şartlarda banka kiracının istemi üzerine
güvenceyi geri vermekle yükümlüdür.
`;


const article333 =
  `
Kiracının ölmesi durumunda mirasçıları,
yasal fesih bildirim süresine uyarak
en yakın fesih dönemi sonu için
sözleşmeyi feshedebilirler.
`;


console.log(
  "\nEmbeddingler oluşturuluyor..."
);


const queryEmbedding =
  await embed(
    `query: ${query}`
  );


const article342Embedding =
  await embed(
    `passage: ${article342}`
  );


const article333Embedding =
  await embed(
    `passage: ${article333}`
  );


console.log(
  "\nEmbedding boyutu:",
  queryEmbedding.length
);


const score342 =
  cosineSimilarity(
    queryEmbedding,
    article342Embedding
  );


const score333 =
  cosineSimilarity(
    queryEmbedding,
    article333Embedding
  );


console.log(
  "\n--- SONUÇ ---"
);


console.log(
  "Madde 342 benzerliği:",
  score342.toFixed(4)
);


console.log(
  "Madde 333 benzerliği:",
  score333.toFixed(4)
);


if (
  score342 > score333
) {
  console.log(
    "\n✅ Semantic retrieval doğru yönde çalışıyor."
  );
} else {
  console.log(
    "\n❌ Beklenmeyen sonuç: yanlış madde daha yüksek."
  );
}


await extractor.dispose();


console.log(
  "\nTest tamamlandı."
);