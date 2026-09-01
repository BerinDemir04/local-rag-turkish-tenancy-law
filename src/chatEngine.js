import {
  FoundryLocalManager
} from "foundry-local-sdk";

import {
  VectorStore
} from "./vectorStore.js";

import {
  EmbeddingService
} from "./embeddingService.js";

import {
  config
} from "./config.js";

import {
  SYSTEM_PROMPT
} from "./prompts.js";


export class ChatEngine {

  constructor() {
    this.chatClient = null;
    this.model = null;
    this.store = null;
    this.embeddingService = null;
    this.compactMode = false;
    this.modelAlias = null;
    this._statusCallback = null;
  }


  // =========================================================
  // INITIALIZATION
  // =========================================================

  onStatus(callback) {
    this._statusCallback = callback;
  }


  _emitStatus(phase, message, progress) {
    const status = {
      phase,
      message,
      ...(progress !== undefined ? { progress } : {}),
    };

    console.log(`[ChatEngine] ${message}`);

    if (this._statusCallback) {
      this._statusCallback(status);
    }
  }


  async init() {
    this._emitStatus(
      "init",
      "Initializing Foundry Local SDK..."
    );

    const manager =
      FoundryLocalManager.create({
        appName: "gas-field-local-rag",
      });

    this.model =
      await manager.catalog.getModel(
        config.model
      );

    this.modelAlias =
      this.model.alias;

    this._emitStatus(
      "variant",
      `Selected model: ${this.modelAlias}`
    );

    if (!this.model.isCached) {
      this._emitStatus(
        "download",
        `Downloading ${this.modelAlias}...`,
        0
      );

      await this.model.download(
        (progress) => {
          const pct =
            Math.round(progress * 100);

          this._emitStatus(
            "download",
            `Downloading ${this.modelAlias}... ${pct}%`,
            progress
          );
        }
      );
    }

    this._emitStatus(
      "loading",
      `Loading ${this.modelAlias} into memory...`
    );

    await this.model.load();

    this.chatClient =
      this.model.createChatClient();

    this.chatClient.settings.temperature =
      0.0;

    this.chatClient.settings.topP =
      0.45;

    this.chatClient.settings.maxTokens =
      120;

    this._emitStatus(
      "embedding",
      "Loading local embedding model..."
    );

    this.embeddingService =
      new EmbeddingService(
        config.embeddingModel
      );

    await this.embeddingService.init();

    this.store =
      new VectorStore(
        config.dbPath
      );

    const count =
      this.store.count();

    this._emitStatus(
      "ready",
      `RAG ready: ${count} legal article chunks indexed.`
    );
  }


  // =========================================================
  // BASIC HELPERS
  // =========================================================

  getStore() {
    return this.store;
  }


  setCompactMode(enabled) {
    this.compactMode = enabled;

    console.log(
      `[ChatEngine] Compact mode: ${
        enabled ? "ON" : "OFF"
      }`
    );
  }


  _getArticleNumber(content) {
    const match =
      String(content ?? "").match(
        /\bMADDE\s+(\d+)/iu
      );

    return match
      ? match[1]
      : null;
  }



  // =========================================================
  // QUERY NORMALIZATION
  // =========================================================

  _expandLegalQuery(userMessage) {
    const original =
      String(userMessage ?? "").trim();

    const lower =
      original.toLocaleLowerCase(
        "tr-TR"
      );

    const additions = [];


    // ---------------------------------------------------------
    // BASIC PARTY NORMALIZATION
    // ---------------------------------------------------------

    if (
      /\bev sahibi\b/u.test(lower)
    ) {
      additions.push(
        "kiraya veren"
      );
    }


    // ---------------------------------------------------------
    // DEPOSIT / SECURITY
    // ---------------------------------------------------------

    if (
      /\bdepozito[\p{L}]*/u.test(
        lower
      )
    ) {
      additions.push(
        "güvence",
        "güvence bedeli",
        "kiracının güvence vermesi"
      );
    }


    // ---------------------------------------------------------
    // EARLY RETURN
    // ---------------------------------------------------------

    if (
      /\berken ayrıl[\p{L}]*/u.test(
        lower
      ) ||
      /\berken çık[\p{L}]*/u.test(
        lower
      ) ||
      /sözleşme[\p{L}]*\s+bitmeden/u.test(
        lower
      )
    ) {
      additions.push(
        "kiralananın sözleşmenin bitiminden önce geri verilmesi"
      );
    }


    if (
      /\byeni kiracı\b/u.test(
        lower
      )
    ) {
      additions.push(
        "kira ilişkisini devralmaya hazır yeni kiracı",
        "ödeme gücüne sahip yeni kiracı"
      );
    }


    // ---------------------------------------------------------
    // SALE / CHANGE OF OWNER
    // ---------------------------------------------------------

    const asksPropertySale =
      (
        /\bev\b/u.test(lower) ||
        /\bkiralanan[\p{L}]*/u.test(lower)
      ) &&
      (
        /satıl[\p{L}]*/u.test(lower) ||
        /satış[\p{L}]*/u.test(lower) ||
        /el değiştir[\p{L}]*/u.test(lower)
      );


    if (asksPropertySale) {
      additions.push(
        "kiralananın el değiştirmesi",
        "sözleşmenin kurulmasından sonra kiralanan herhangi bir sebeple el değiştirirse",
        "yeni malik kira sözleşmesinin tarafı olur"
      );
    }


    // ---------------------------------------------------------
    // LEASE RELATIONSHIP TRANSFER
    // ---------------------------------------------------------

    const asksLeaseTransfer =
      (
        /kira\s+sözleşme[\p{L}]*/u.test(lower) ||
        /kira\s+ilişki[\p{L}]*/u.test(lower)
      ) &&
      (
        /devret[\p{L}]*/u.test(lower) ||
        /devr[\p{L}]*/u.test(lower)
      );


    if (asksLeaseTransfer) {
      additions.push(
        "kira ilişkisinin devri",
        "kiracı kiraya verenin yazılı rızasını almadıkça kira ilişkisini başkasına devredemez",
        "kiraya verenin yazılı rızası"
      );
    }


    // ---------------------------------------------------------
    // LANDLORD RENOVATION / ALTERATION
    // ---------------------------------------------------------

    const landlordMentioned =
      /\bev sahibi\b/u.test(
        lower
      ) ||
      /\bkiraya veren\b/u.test(
        lower
      );


    const asksLandlordRenovation =
      landlordMentioned &&
      (
        /tadilat[\p{L}]*/u.test(lower) ||
        /yenilik[\p{L}]*/u.test(lower) ||
        /değişiklik[\p{L}]*/u.test(lower) ||
        /onarım[\p{L}]*/u.test(lower) ||
        /bakım[\p{L}]*/u.test(lower)
      ) &&
      (
        /katlan[\p{L}]*/u.test(lower) ||
        /yapmak/u.test(lower) ||
        /yapabilir/u.test(lower) ||
        /zorunda/u.test(lower)
      );


    if (asksLandlordRenovation) {
      additions.push(
        "kiraya veren tarafından kiralananda yenilik ve değişiklik yapılması",
        "kira sözleşmesinin feshini gerektirmeyen",
        "kiracıdan katlanması beklenebilecek yenilik ve değişiklikler",
        "kiraya veren kiracının menfaatlerini gözetmekle yükümlüdür",
        "kiracının kira bedelinin indirilmesine ve zararının giderilmesine ilişkin hakları saklıdır"
      );
    }


    // ---------------------------------------------------------
    // RENT / PAYMENT
    // ---------------------------------------------------------

    const mentionsRent =
      /\bkira[\p{L}]*/u.test(
        lower
      );


    const mentionsNonPayment =
      /ödemez[\p{L}]*/u.test(
        lower
      ) ||
      /ödemed[\p{L}]*/u.test(
        lower
      ) ||
      /ödenmez[\p{L}]*/u.test(
        lower
      ) ||
      /ödenmed[\p{L}]*/u.test(
        lower
      ) ||
      /geç\s+öde[\p{L}]*/u.test(
        lower
      ) ||
      /zamanında\s+öde[\p{L}]*me/u.test(
        lower
      );


    const asksPenalty =
      (
        /ceza/u.test(lower) ||
        /ceza\s+koşulu/u.test(lower) ||
        /ceza\s+şartı/u.test(lower)
      ) &&
      mentionsRent;


    if (asksPenalty) {
      additions.push(
        "kiracı aleyhine düzenleme yasağı",
        "kira bedelinin zamanında ödenmemesi hâlinde ceza koşulu",
        "sonraki kira bedellerinin muaccel olacağına ilişkin anlaşmalar geçersizdir"
      );
    }


    const asksPaymentTiming =
      mentionsRent &&
      !mentionsNonPayment &&
      !asksPenalty &&
      (
        /\bne zaman\b/u.test(
          lower
        ) ||
        /\bhangi tarihte\b/u.test(
          lower
        ) ||
        /\bhangi gün\b/u.test(
          lower
        ) ||
        /\bödeme zamanı\b/u.test(
          lower
        ) ||
        /\bödemem gerekir\b/u.test(
          lower
        ) ||
        /\bödenir\b/u.test(
          lower
        ) ||
        /\bödemeliyim\b/u.test(
          lower
        )
      );


    if (asksPaymentTiming) {
      additions.push(
        "kira bedelini ödeme borcunun ifa zamanı",
        "ifa zamanı",
        "kira bedelinin ödeme zamanı",
        "aksine sözleşme ve yerel âdet olmadıkça kira bedeli ve yan giderlerin ödeme zamanı"
      );
    }


    // ---------------------------------------------------------
    // NON-PAYMENT / DEFAULT
    // ---------------------------------------------------------

    if (
      mentionsRent &&
      mentionsNonPayment &&
      !asksPenalty
    ) {
      additions.push(
        "kiracının temerrüdü",
        "muaccel kira bedelini veya yan gideri ödeme borcu",
        "kiraya veren kiracıya yazılı olarak süre verir",
        "ifa etmeme durumunda sözleşmeyi feshedeceğini bildirir"
      );
    }


    // ---------------------------------------------------------
    // RENT INCREASE
    // ---------------------------------------------------------

    const standaloneZam =
      /(?:^|[^\p{L}])zam(?:[^\p{L}]|$)/u
        .test(lower);

    const rentIncrease =
      /kira\s+(?:bedeli\s+)?artış[\p{L}]*/u
        .test(lower) ||
      /kiraya\s+zam/u.test(lower) ||
      (
        standaloneZam &&
        mentionsRent
      );

    const asksRentLawsuit =
      /dava/u.test(lower) ||
      /mahkeme/u.test(lower) ||
      /tespit/u.test(lower);

    const asksIncreaseLimit =
      /istediği\s+kadar/u.test(
        lower
      ) ||
      /ne\s+kadar/u.test(
        lower
      ) ||
      /en\s+fazla/u.test(
        lower
      ) ||
      /oran[\p{L}]*/u.test(
        lower
      ) ||
      /yüzde/u.test(lower) ||
      /sınır[\p{L}]*/u.test(
        lower
      );


    if (
      rentIncrease &&
      !asksRentLawsuit
    ) {
      additions.push(
        "yenilenen kira dönemlerinde uygulanacak kira bedeli",
        "kira bedeline ilişkin anlaşma",
        "tüketici fiyat endeksindeki oniki aylık ortalamalara göre değişim oranı"
      );

      if (asksIncreaseLimit) {
        additions.push(
          "kira bedeli artış sınırı",
          "bir önceki kira yılının tüketici fiyat endeksindeki oniki aylık ortalamalara göre değişim oranı"
        );
      }
    }


    if (asksRentLawsuit) {
      additions.push(
        "kira bedelinin belirlenmesine ilişkin dava",
        "dava açma süresi",
        "mahkemece belirlenecek kira bedeli",
        "kararın etkisi"
      );
    }


    // ---------------------------------------------------------
    // FIXED TERM
    // ---------------------------------------------------------

    const mentionsContractEnd =
      /sözleşme[\p{L}]*\s+bitti/u.test(
        lower
      ) ||
      /sözleşme[\p{L}]*\s+süresi\s+bitti/u.test(
        lower
      ) ||
      /süre[\p{L}]*\s+doldu/u.test(
        lower
      ) ||
      /kira\s+sözleşme[\p{L}]*\s+bitti/u.test(
        lower
      );


    if (mentionsContractEnd) {
      additions.push(
        "belirli süreli kira sözleşmesinin süresinin bitimi",
        "kiraya veren sözleşme süresinin bitimine dayanarak sözleşmeyi sona erdiremez",
        "sözleşme aynı koşullarla bir yıl için uzatılmış sayılır"
      );
    }


    // ---------------------------------------------------------
    // LANDLORD NEED / NEW OWNER / RE-RENTING
    // ---------------------------------------------------------

    const personalNeedMentioned =
      /kendi[\p{L}]*/u.test(
        lower
      ) ||
      /ihtiyaç[\p{L}]*/u.test(
        lower
      ) ||
      /gereksinim[\p{L}]*/u.test(
        lower
      );


    const useOrTerminationMentioned =
      /kullan[\p{L}]*/u.test(
        lower
      ) ||
      /otur[\p{L}]*/u.test(
        lower
      ) ||
      /çıkar[\p{L}]*/u.test(
        lower
      ) ||
      /sona\s+erdir[\p{L}]*/u.test(
        lower
      );


    const mentionsPurchase =
      /satın\s+al[\p{L}]*/u.test(
        lower
      );

    const mentionsNew =
      /\byeni\b/u.test(
        lower
      );

    const newOwnerMentioned =
      /yeni\s+malik/u.test(
        lower
      ) ||
      /yeni\s+ev\s+sahibi/u.test(
        lower
      ) ||
      (
        mentionsPurchase &&
        mentionsNew
      ) ||
      /sonradan\s+edin[\p{L}]*/u.test(
        lower
      ) ||
      /kiralananı\s+sonradan\s+edin[\p{L}]*/u.test(
        lower
      );


    const asksReRentAfterNeed =
      personalNeedMentioned &&
      (
        /çıkardıktan\s+sonra/u.test(lower) ||
        /boşalttıktan\s+sonra/u.test(lower) ||
        /tahliye[\p{L}]*\s+sonra/u.test(lower) ||
        /hemen\s+sonra/u.test(lower)
      ) &&
      (
        /başka(?:sı|sına| birine)/u.test(lower) ||
        /yeniden\s+kirala[\p{L}]*/u.test(lower) ||
        /tekrar\s+kirala[\p{L}]*/u.test(lower) ||
        /kiralayabilir/u.test(lower)
      );


    if (asksReRentAfterNeed) {
      additions.push(
        "yeniden kiralama yasağı",
        "gereksinim amacıyla kiralananın boşaltılmasını sağladığında",
        "haklı sebep olmaksızın üç yıl geçmedikçe eski kiracısından başkasına kiralayamaz",
        "kiraya veren bu hükümlere aykırı davrandığı takdirde eski kiracısına tazminat"
      );
    }


    if (
      landlordMentioned &&
      personalNeedMentioned &&
      useOrTerminationMentioned &&
      !asksReRentAfterNeed
    ) {
      if (newOwnerMentioned) {
        additions.push(
          "kiralananı sonradan edinen kişi",
          "yeni malikin gereksinimi",
          "edinme tarihinden başlayarak kiracıya yazılı bildirim",
          "kiralananı kendisi için konut veya işyeri gereksinimi sebebiyle kullanma zorunluluğu"
        );
      } else {
        additions.push(
          "kiraya veren kiralananı kendisi için konut veya işyeri gereksinimi sebebiyle kullanma zorunluluğu",
          "kiraya verenin gereksinimi",
          "kiraya verenin gereksinimi sebebiyle dava yoluyla kira sözleşmesini sona erdirmesi"
        );
      }
    }


    if (
      additions.length === 0
    ) {
      return original;
    }


    const unique =
      [...new Set(additions)];

    const expanded =
      `${original} ${unique.join(" ")}`;

    console.log(
      "[ChatEngine] Expanded legal query:",
      expanded
    );

    return expanded;
  }


  // =========================================================
  // VECTOR HELPERS
  // =========================================================

  _cosineSimilarity(a, b) {
    if (
      !Array.isArray(a) ||
      !Array.isArray(b) ||
      a.length !== b.length ||
      a.length === 0
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
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
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


  // =========================================================
  // SENTENCE SPLITTING
  // =========================================================

  _splitIntoSentences(text) {
    const protectedText =
      String(text ?? "")
        .replace(
          /\s+/g,
          " "
        )
        .replace(
          /(^|[\s;:])(\d{1,2})\.(?=\s)/gu,
          "$1$2§"
        );


    return protectedText
      .split(
        /(?<=[.!?])\s+/u
      )
      .map(
        (sentence) =>
          sentence
            .replace(
              /(\d{1,2})§/gu,
              "$1."
            )
            .trim()
      )
      .filter(
        (sentence) => {
          if (
            sentence.length < 45
          ) {
            return false;
          }

          const words =
            sentence
              .split(/\s+/u)
              .filter(Boolean);

          return (
            words.length >= 7
          );
        }
      );
  }


  // =========================================================
  // RETRIEVAL
  // =========================================================

  async _retrieve(userMessage) {
    const expandedQuery =
      this._expandLegalQuery(
        userMessage
      );

    console.log(
      "[ChatEngine] Query embedding oluşturuluyor..."
    );

    const queryEmbedding =
      await this.embeddingService.embedQuery(
        expandedQuery
      );

    console.log(
      "[ChatEngine] Hybrid retrieval çalışıyor..."
    );

    const chunks =
      this.store.searchHybrid(
        expandedQuery,
        queryEmbedding,
        {
          topK:
            config.topK,

          semanticK:
            config.semanticK,

          lexicalK:
            config.lexicalK,

          semanticWeight:
            config.semanticWeight,

          lexicalWeight:
            config.lexicalWeight,
        }
      );

    console.log(
      `[ChatEngine] ${chunks.length} aday madde bulundu.`
    );

    chunks.forEach(
      (chunk, index) => {
        const article =
          this._getArticleNumber(
            chunk.content
          );

        console.log(
          `[RAG ${index + 1}]`,
          article
            ? `MADDE ${article}`
            : chunk.title,
          "| semantic:",
          chunk.semanticScore
            ?.toFixed?.(4) ??
            "-",
          "| lexical:",
          chunk.lexicalScore
            ?.toFixed?.(4) ??
            "-",
          "| hybrid:",
          chunk.hybridScore
            ?.toFixed?.(5) ??
            "-"
        );
      }
    );

    return {
      chunks,
      queryEmbedding,
    };
  }


  // =========================================================
  // SENTENCE RANKING
  // =========================================================

  async _rankSentences(
    queryEmbedding,
    chunks
  ) {
    const candidates = [];

    for (
      let chunkRank = 0;
      chunkRank < chunks.length;
      chunkRank++
    ) {
      const chunk =
        chunks[chunkRank];

      const article =
        this._getArticleNumber(
          chunk.content
        );

      const sentences =
        this._splitIntoSentences(
          chunk.content
        );

      for (
        let sentenceIndex = 0;
        sentenceIndex <
          sentences.length;
        sentenceIndex++
      ) {
        const sentence =
          sentences[sentenceIndex];

        const passageEmbedding =
          await this.embeddingService.embedPassage(
            sentence
          );

        const semanticScore =
          this._cosineSimilarity(
            queryEmbedding,
            passageEmbedding
          );

        const rankBonus =
          Math.max(
            0,
            0.012 -
              chunkRank * 0.003
          );

        const finalScore =
          semanticScore +
          rankBonus;

        candidates.push({
          article,
          chunk,
          sentence,
          sentenceIndex,
          semanticScore,
          finalScore,
        });
      }
    }

    candidates.sort(
      (a, b) =>
        b.finalScore -
        a.finalScore
    );

    console.log(
      "[Sentence ranking] Top results:"
    );

    candidates
      .slice(0, 10)
      .forEach(
        (item, index) => {
          console.log(
            `[SENT ${index + 1}] MADDE ${item.article} | semantic=${item.semanticScore.toFixed(4)} | final=${item.finalScore.toFixed(4)} | ${item.sentence.slice(0, 120)}`
          );
        }
      );

    return candidates;
  }


  // =========================================================
  // INTENT-AWARE ARTICLE ADJUSTMENT
  // =========================================================

  _getIntentArticleAdjustment(
    userMessage,
    items
  ) {
    const query =
      String(userMessage ?? "")
        .toLocaleLowerCase(
          "tr-TR"
        );

    const articleText =
      items
        .map(
          (item) =>
            String(
              item.chunk?.content ??
                ""
            )
        )
        .join(" ")
        .toLocaleLowerCase(
          "tr-TR"
        );

    let adjustment = 0;


    // ---------------------------------------------------------
    // PROPERTY SALE / CHANGE OF OWNER
    // ---------------------------------------------------------

    const asksPropertySale =
      (
        /\bev\b/u.test(query) ||
        /\bkiralanan[\p{L}]*/u.test(query)
      ) &&
      (
        /satıl[\p{L}]*/u.test(query) ||
        /satış[\p{L}]*/u.test(query) ||
        /el değiştir[\p{L}]*/u.test(query)
      );


    const articleIsChangeOfOwner =
      /kiralananın el değiştirmesi/u.test(
        articleText
      ) ||
      (
        /kiralanan herhangi bir sebeple el değiştirirse/u.test(
          articleText
        ) &&
        /yeni malik/u.test(
          articleText
        )
      );


    if (
      asksPropertySale &&
      articleIsChangeOfOwner
    ) {
      adjustment += 0.085;
    }


    if (
      asksPropertySale &&
      /kiracıdan kaynaklanan sebeplerle/u.test(
        articleText
      )
    ) {
      adjustment -= 0.055;
    }


    // ---------------------------------------------------------
    // LEASE RELATIONSHIP TRANSFER
    // ---------------------------------------------------------

    const asksLeaseTransfer =
      (
        /kira\s+sözleşme[\p{L}]*/u.test(query) ||
        /kira\s+ilişki[\p{L}]*/u.test(query)
      ) &&
      (
        /devret[\p{L}]*/u.test(query) ||
        /devr[\p{L}]*/u.test(query)
      );


    const articleIsLeaseTransfer =
      /kira ilişkisinin devri/u.test(
        articleText
      ) ||
      /kira ilişkisini başkasına devredemez/u.test(
        articleText
      );


    const articleIsSublease =
      /alt kira ve kullanım hakkının devri/u.test(
        articleText
      ) ||
      /kiralananı tamamen veya kısmen başkasına kiraya/u.test(
        articleText
      );


    if (
      asksLeaseTransfer &&
      articleIsLeaseTransfer
    ) {
      adjustment += 0.090;
    }


    if (
      asksLeaseTransfer &&
      articleIsSublease
    ) {
      adjustment -= 0.055;
    }


    // ---------------------------------------------------------
    // LANDLORD RENOVATION
    // ---------------------------------------------------------

    const asksLandlordRenovation =
      (
        /\bev sahibi\b/u.test(query) ||
        /\bkiraya veren\b/u.test(query)
      ) &&
      (
        /tadilat[\p{L}]*/u.test(query) ||
        /yenilik[\p{L}]*/u.test(query) ||
        /değişiklik[\p{L}]*/u.test(query) ||
        /onarım[\p{L}]*/u.test(query) ||
        /bakım[\p{L}]*/u.test(query)
      ) &&
      (
        /katlan[\p{L}]*/u.test(query) ||
        /zorunda/u.test(query) ||
        /yapmak/u.test(query) ||
        /yapabilir/u.test(query)
      );


    const articleIsLandlordAlteration =
      /kiraya veren,\s*kiralananda/u.test(
        articleText
      ) &&
      /yenilik ve değişiklik/u.test(
        articleText
      ) &&
      /kiracıdan katlanması beklenebilecek/u.test(
        articleText
      );


    if (
      asksLandlordRenovation &&
      articleIsLandlordAlteration
    ) {
      adjustment += 0.080;
    }


    if (
      asksLandlordRenovation &&
      articleIsSublease
    ) {
      adjustment -= 0.050;
    }


    // ---------------------------------------------------------
    // PENALTY CLAUSE
    // ---------------------------------------------------------

    const asksPenalty =
      /\bkira[\p{L}]*/u.test(
        query
      ) &&
      (
        /ceza/u.test(query) ||
        /ceza\s+koşulu/u.test(query) ||
        /ceza\s+şartı/u.test(query)
      );


    const articleHasPenaltyRule =
      /kira bedelinin zamanında ödenmemesi hâlinde ceza koşulu/u.test(
        articleText
      ) ||
      /ceza koşulu ödeneceğine/u.test(
        articleText
      );


    const articleIsDefault =
      /kiracının temerrüdü/u.test(
        articleText
      ) ||
      /muaccel olan kira bedelini veya yan gideri ödeme borcunu ifa etmezse/u.test(
        articleText
      );


    if (
      asksPenalty &&
      articleHasPenaltyRule
    ) {
      adjustment += 0.090;
    }


    if (
      asksPenalty &&
      articleIsDefault
    ) {
      adjustment -= 0.055;
    }


    // ---------------------------------------------------------
    // RE-RENTING AFTER NEED-BASED EVICTION
    // ---------------------------------------------------------

    const asksReRentAfterNeed =
      (
        /ihtiyaç[\p{L}]*/u.test(query) ||
        /gereksinim[\p{L}]*/u.test(query)
      ) &&
      (
        /çıkardıktan\s+sonra/u.test(query) ||
        /boşalttıktan\s+sonra/u.test(query) ||
        /tahliye[\p{L}]*\s+sonra/u.test(query) ||
        /hemen\s+sonra/u.test(query)
      ) &&
      (
        /başka(?:sı|sına| birine)/u.test(query) ||
        /yeniden\s+kirala[\p{L}]*/u.test(query) ||
        /tekrar\s+kirala[\p{L}]*/u.test(query) ||
        /kiralayabilir/u.test(query)
      );


    const articleIsReRentProhibition =
      /yeniden kiralama yasağı/u.test(
        articleText
      ) ||
      (
        /gereksinim amacıyla kiralananın boşaltılmasını sağladığında/u.test(
          articleText
        ) &&
        /üç yıl geçmedikçe/u.test(
          articleText
        )
      );


    const articleIsNeedTermination =
      /konut ya da işyeri gereksinimi sebebiyle kullanma zorunluluğu/u.test(
        articleText
      ) &&
      !articleIsReRentProhibition;


    if (
      asksReRentAfterNeed &&
      articleIsReRentProhibition
    ) {
      adjustment += 0.110;
    }


    if (
      asksReRentAfterNeed &&
      articleIsNeedTermination
    ) {
      adjustment -= 0.070;
    }
    // ---------------------------------------------------------
    // LANDLORD NEED / NEW OWNER
    // ---------------------------------------------------------

    const asksLandlordNeed =
      (
        /\bev sahibi\b/u.test(
          query
        ) ||
        /\bkiraya veren\b/u.test(
          query
        )
      ) &&
      (
        /kendi[\p{L}]*/u.test(
          query
        ) ||
        /ihtiyaç[\p{L}]*/u.test(
          query
        ) ||
        /gereksinim[\p{L}]*/u.test(
          query
        )
      );


    const asksPurchase =
      /satın\s+al[\p{L}]*/u.test(
        query
      );

    const asksNew =
      /\byeni\b/u.test(
        query
      );

    const asksNewOwner =
      /yeni\s+malik/u.test(
        query
      ) ||
      /yeni\s+ev\s+sahibi/u.test(
        query
      ) ||
      (
        asksPurchase &&
        asksNew
      ) ||
      /sonradan\s+edin[\p{L}]*/u.test(
        query
      );


    const articleIsNewOwnerContext =
      /yeni\s+malikin\s+gereksinimi/u.test(
        articleText
      ) ||
      /kiralananı\s+sonradan\s+edinen\s+kişi/u.test(
        articleText
      ) ||
      /edinme\s+tarihinden/u.test(
        articleText
      );


    const articleIsGeneralLandlordNeed =
      (
        /kiralananı\s+kendisi,\s*eşi,\s*altsoyu/u.test(
          articleText
        ) ||
        /konut\s+ya\s+da\s+işyeri\s+gereksinimi/u.test(
          articleText
        )
      ) &&
      !articleIsNewOwnerContext &&
      !articleIsReRentProhibition;


    if (
      asksLandlordNeed &&
      !asksNewOwner &&
      !asksReRentAfterNeed
    ) {
      if (
        articleIsNewOwnerContext
      ) {
        adjustment -=
          0.055;
      }

      if (
        articleIsGeneralLandlordNeed
      ) {
        adjustment +=
          0.020;
      }
    }


    if (
      asksLandlordNeed &&
      asksNewOwner &&
      !asksReRentAfterNeed &&
      articleIsNewOwnerContext
    ) {
      adjustment +=
        0.040;
    }


    // ---------------------------------------------------------
    // DEPOSIT / SECURITY AMOUNT
    // ---------------------------------------------------------

    const asksSecurity =
      /\bdepozito[\p{L}]*/u.test(
        query
      ) ||
      /\bgüvence\b/u.test(
        query
      ) ||
      /\bgüvence bedeli\b/u.test(
        query
      );


    const asksSecurityAmount =
      asksSecurity &&
      (
        /\ben fazla\b/u.test(
          query
        ) ||
        /\bne kadar\b/u.test(
          query
        ) ||
        /\bmiktar[\p{L}]*/u.test(
          query
        ) ||
        /\bsınır[\p{L}]*/u.test(
          query
        ) ||
        /\bkaç\b/u.test(
          query
        )
      );


    const asksBankruptcy =
      /iflas[\p{L}]*/u.test(
        query
      ) ||
      /iflas masası/u.test(
        query
      );


    const articleHasSecurityLimit =
      /güvence.*üç aylık kira bedelini aşamaz/u.test(
        articleText
      ) ||
      /üç aylık kira bedelini aşamaz/u.test(
        articleText
      );


    const articleIsBankruptcySecurity =
      /kiracının iflası/u.test(
        articleText
      ) ||
      /iflas masası/u.test(
        articleText
      );


    if (
      asksSecurityAmount &&
      articleHasSecurityLimit
    ) {
      adjustment +=
        0.060;
    }


    if (
      asksSecurityAmount &&
      !asksBankruptcy &&
      articleIsBankruptcySecurity
    ) {
      adjustment -=
        0.040;
    }


    // ---------------------------------------------------------
    // PAYMENT TIMING
    // ---------------------------------------------------------

    const asksPaymentTiming =
      /\bkira[\p{L}]*/u.test(
        query
      ) &&
      !asksPenalty &&
      (
        /\bne zaman\b/u.test(
          query
        ) ||
        /\bhangi tarihte\b/u.test(
          query
        ) ||
        /\bhangi gün\b/u.test(
          query
        ) ||
        /\bödeme zamanı\b/u.test(
          query
        ) ||
        /\bödemem gerekir\b/u.test(
          query
        ) ||
        /\bödemeliyim\b/u.test(
          query
        ) ||
        /\bödenir\b/u.test(
          query
        )
      );


    const articleIsPaymentTiming =
      /\bifa zamanı\b/u.test(
        articleText
      ) ||
      (
        /aksine sözleşme ve yerel âdet olmadıkça/u.test(
          articleText
        ) &&
        /kira bedelini/u.test(
          articleText
        )
      );


    const articleIsGeneralPaymentDuty =
      /kira bedelini ödemekle yükümlüdür/u.test(
        articleText
      ) &&
      !articleIsPaymentTiming;


    if (
      asksPaymentTiming &&
      articleIsPaymentTiming
    ) {
      adjustment +=
        0.060;
    }


    if (
      asksPaymentTiming &&
      articleIsGeneralPaymentDuty
    ) {
      adjustment -=
        0.035;
    }


    return adjustment;
  }


  // =========================================================
  // ARTICLE SELECTION
  // =========================================================

  _chooseArticle(
    rankedSentences,
    userMessage
  ) {
    if (
      rankedSentences.length === 0
    ) {
      return null;
    }

    const articleGroups =
      new Map();


    for (
      const item of
      rankedSentences
    ) {
      if (!item.article) {
        continue;
      }

      if (
        !articleGroups.has(
          item.article
        )
      ) {
        articleGroups.set(
          item.article,
          []
        );
      }

      articleGroups
        .get(item.article)
        .push(item);
    }


    let bestArticle =
      null;

    let bestScore =
      -Infinity;


    for (
      const [
        article,
        items
      ] of articleGroups
    ) {
      const bestItems =
        [...items]
          .sort(
            (a, b) =>
              b.finalScore -
              a.finalScore
          )
          .slice(0, 2);


      const sentenceScore =
        bestItems.reduce(
          (sum, item) =>
            sum +
            item.finalScore,
          0
        ) /
        bestItems.length;


      const chunk =
        bestItems[0]?.chunk;


      const lexicalBonus =
        (
          chunk?.lexicalScore ??
          0
        ) * 0.05;


      const intentAdjustment =
        this._getIntentArticleAdjustment(
          userMessage,
          items
        );


      const total =
        sentenceScore +
        lexicalBonus +
        intentAdjustment;


      console.log(
        `[Article score] MADDE ${article}: sentence=${sentenceScore.toFixed(4)} lexicalBonus=${lexicalBonus.toFixed(4)} intentAdjustment=${intentAdjustment.toFixed(4)} total=${total.toFixed(4)}`
      );


      if (
        total > bestScore
      ) {
        bestScore =
          total;

        bestArticle =
          article;
      }
    }


    console.log(
      `[ChatEngine] Selected article: MADDE ${bestArticle}`
    );

    return bestArticle;
  }


  // =========================================================
  // RELEVANT SENTENCES
  // =========================================================

  _getRelevantSentences(
    rankedSentences,
    article
  ) {
    const selected =
      rankedSentences
        .filter(
          (item) =>
            item.article ===
            article
        )
        .sort(
          (a, b) =>
            b.finalScore -
            a.finalScore
        )
        .slice(
          0,
          this.compactMode
            ? 2
            : 3
        );


    selected.forEach(
      (item, index) => {
        console.log(
          `[FINAL SENT ${index + 1}] ${item.finalScore.toFixed(4)} | ${item.sentence}`
        );
      }
    );


    return selected;
  }


  _cleanLegalSentence(
    sentence,
    article
  ) {
    let cleaned =
      String(
        sentence ?? ""
      ).trim();


    const marker =
      new RegExp(
        `^.*?MADDE\\s+${article}\\s*[-–—]\\s*`,
        "iu"
      );


    if (
      marker.test(cleaned)
    ) {
      cleaned =
        cleaned.replace(
          marker,
          ""
        );
    }


    return cleaned
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }


  _buildLegalContext(
    article,
    relevantSentences
  ) {
    return relevantSentences
      .map(
        (item) =>
          this._cleanLegalSentence(
            item.sentence,
            article
          )
      )
      .filter(Boolean)
      .join("\n");
  }


  // =========================================================
  // QUESTION-FOCUSED CONTEXT
  // =========================================================

  _splitIntoFocusUnits(text) {
    const normalized =
      String(text ?? "")
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (!normalized) {
      return [];
    }


    const numberedMatches =
      [
        ...normalized.matchAll(
          /\b\d{1,2}\.\s/gu
        ),
      ];


    if (
      numberedMatches.length < 2
    ) {
      return [
        normalized
      ];
    }


    const firstIndex =
      numberedMatches[0].index ??
      0;

    const prefix =
      normalized
        .slice(
          0,
          firstIndex
        )
        .trim();


    const units = [];


    for (
      let i = 0;
      i < numberedMatches.length;
      i++
    ) {
      const start =
        numberedMatches[i].index ??
        0;

      const end =
        i + 1 <
        numberedMatches.length
          ? numberedMatches[i + 1].index
          : normalized.length;

      const part =
        normalized
          .slice(
            start,
            end
          )
          .trim();

      if (
        part.length >= 25
      ) {
        units.push(
          prefix
            ? `${prefix} ${part}`
            : part
        );
      }
    }


    return (
      units.length > 0
        ? units
        : [normalized]
    );
  }


  async _buildFocusedLegalContext(
    queryEmbedding,
    article,
    relevantSentences
  ) {
    const legalContext =
      this._buildLegalContext(
        article,
        relevantSentences
      );


    const units = [];


    for (
      const item of
      relevantSentences
    ) {
      const cleaned =
        this._cleanLegalSentence(
          item.sentence,
          article
        );

      const splitUnits =
        this._splitIntoFocusUnits(
          cleaned
        );

      for (
        const unit of
        splitUnits
      ) {
        if (
          unit.length < 25
        ) {
          continue;
        }

        units.push(unit);
      }
    }


    if (
      units.length === 0
    ) {
      return {
        legalContext,
        focusContext:
          legalContext,
      };
    }


    const scored = [];


    for (
      const unit of
      units
    ) {
      const embedding =
        await this.embeddingService.embedPassage(
          unit
        );

      const score =
        this._cosineSimilarity(
          queryEmbedding,
          embedding
        );

      scored.push({
        text: unit,
        score,
      });
    }


    scored.sort(
      (a, b) =>
        b.score -
        a.score
    );


    const best =
      scored[0];


    let focusContext =
      best.text.trim();

    const focusLooksIncomplete =
      /[,;:]$/u.test(
        focusContext
      );


    if (
      focusLooksIncomplete
    ) {
      const normalizedLegalContext =
        String(
          legalContext ??
          ""
        )
          .replace(
            /\s+/g,
            " "
          )
          .trim();


      const sharedEndingPatterns = [
        /\bbelirli süreli sözleşmelerde\b/iu,
        /\bbelirsiz süreli sözleşmelerde\b/iu,
      ];


      let sharedEndingIndex =
        -1;


      for (
        const pattern of
        sharedEndingPatterns
      ) {
        const match =
          pattern.exec(
            normalizedLegalContext
          );

        if (
          match &&
          (
            sharedEndingIndex === -1 ||
            match.index <
              sharedEndingIndex
          )
        ) {
          sharedEndingIndex =
            match.index;
        }
      }


      if (
        sharedEndingIndex >= 0
      ) {
        const remainingText =
          normalizedLegalContext
            .slice(
              sharedEndingIndex
            )
            .trim();

        const firstSentenceEnd =
          remainingText.indexOf(
            "."
          );


        const sharedEnding =
          firstSentenceEnd >= 0
            ? remainingText
                .slice(
                  0,
                  firstSentenceEnd + 1
                )
                .trim()
            : remainingText;


        if (
          sharedEnding &&
          !focusContext.includes(
            sharedEnding
          )
        ) {
          focusContext =
            `${focusContext} ${sharedEnding}`
              .replace(
                /\s+/g,
                " "
              )
              .trim();


          console.log(
            "[Answer focus] Ortak hukuki sonuç seçilen bende eklendi."
          );
        }
      }
    }


    focusContext =
      focusContext
        .replace(
          /\s+Dava yoluyla\s*>\s*.*$/iu,
          ""
        )
        .replace(
          /\s+KONU:\s*.*$/iu,
          ""
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();


    console.log(
      "[Answer focus] En ilgili ve tamamlanmış kanun parçası:"
    );

    console.log(
      `[FOCUS 1] ${best.score.toFixed(4)} | ${focusContext}`
    );


    return {
      legalContext,
      focusContext,
    };
  }


  // =========================================================
  // PHI GENERATION
  // =========================================================

  async _generateWithPhi(
    legalQuestion,
    article,
    legalContext,
    focusContext
  ) {
    const messages = [
      {
        role: "system",
        content: `
${SYSTEM_PROMPT}

SEÇİLEN HÜKÜM:
TBK MADDE ${article}

SORUYLA EN İLGİLİ KANUN PARÇASI:
${focusContext}

TAM KANUN METNİ:
${legalContext}
`.trim(),
      },
      {
        role: "user",
        content:
          `Soru: ${legalQuestion}

Bu soruya yalnızca yukarıdaki kanun metnine dayanarak cevap ver. Soruyla ilgisiz bentleri anlatma.`.trim(),
      },
    ];


    this.chatClient.settings.temperature =
      0.0;

    this.chatClient.settings.topP =
      0.35;

    this.chatClient.settings.maxTokens =
      120;


    const response =
      await this.chatClient.completeChat(
        messages
      );


    const rawAnswer =
      response
        .choices?.[0]
        ?.message
        ?.content
        ?.trim() ??
      "";


    console.log(
      "[ChatEngine] Phi raw answer:",
      rawAnswer
    );


    return rawAnswer;
  }


  // =========================================================
  // GENERATION CLEANUP
  // =========================================================

  _trimToCompleteSentences(
    text
  ) {
    const normalized =
      String(text ?? "")
        .replace(
          /\s+/g,
          " "
        )
        .trim();


    if (!normalized) {
      return "";
    }


    const completeSentences =
      normalized.match(
        /[^.!?]+[.!?]+/gu
      );


    if (
      !completeSentences ||
      completeSentences.length === 0
    ) {
      return normalized;
    }


    const cleaned =
      completeSentences
        .slice(0, 3)
        .join(" ")
        .replace(
          /\s+/g,
          " "
        )
        .trim();


    if (
      cleaned !== normalized
    ) {
      console.log(
        "[Quality] Incomplete trailing generation removed."
      );
    }


    return cleaned;
  }


  _looksTruncated(text) {
    const trimmed =
      String(text ?? "")
        .trim();

    if (!trimmed) {
      return true;
    }

    return !/[.!?]$/u.test(
      trimmed
    );
  }


  // =========================================================
  // QUALITY CONTROL
  // =========================================================

  _tokenizeForValidation(text) {
    const ignored =
      new Set([
        "tbk",
        "madde",
        "göre",
        "kanun",
        "ilgili",
        "olarak",
        "ancak",
        "veya",
        "için",
        "olan",
        "bir",
        "ile",
        "daha",
        "kira",
        "sözleşmesi",
        "sözleşmesini",
        "kiralanan",
        "kiralananı",
      ]);


    return (
      String(text ?? "")
        .toLocaleLowerCase(
          "tr-TR"
        )
        .match(
          /[\p{L}\p{N}]+/gu
        ) ??
      []
    ).filter(
      (word) =>
        word.length >= 4 &&
        !ignored.has(
          word
        )
    );
  }


  _calculateSourceOverlap(
    answer,
    source
  ) {
    const answerTokens =
      [
        ...new Set(
          this._tokenizeForValidation(
            answer
          )
        ),
      ];

    const sourceTokens =
      new Set(
        this._tokenizeForValidation(
          source
        )
      );


    if (
      answerTokens.length === 0
    ) {
      return 0;
    }


    let matched = 0;


    for (
      const token of
      answerTokens
    ) {
      if (
        sourceTokens.has(
          token
        )
      ) {
        matched++;
      }
    }


    return (
      matched /
      answerTokens.length
    );
  }


  _calculateFocusOverlap(
    answer,
    focusContext
  ) {
    const answerTokens =
      [
        ...new Set(
          this._tokenizeForValidation(
            answer
          )
        ),
      ];

    const focusTokens =
      new Set(
        this._tokenizeForValidation(
          focusContext
        )
      );


    if (
      answerTokens.length === 0 ||
      focusTokens.size === 0
    ) {
      return 0;
    }


    let matched = 0;


    for (
      const token of
      answerTokens
    ) {
      if (
        focusTokens.has(
          token
        )
      ) {
        matched++;
      }
    }


    return (
      matched /
      answerTokens.length
    );
  }


  _hasSevereRepetition(text) {
    const words =
      String(text ?? "")
        .toLocaleLowerCase(
          "tr-TR"
        )
        .match(
          /[\p{L}\p{N}]+/gu
        ) ??
      [];


    if (
      words.length < 10
    ) {
      return false;
    }


    const triples =
      new Map();


    for (
      let i = 0;
      i <=
        words.length - 3;
      i++
    ) {
      const triple =
        words
          .slice(
            i,
            i + 3
          )
          .join(" ");


      triples.set(
        triple,
        (
          triples.get(
            triple
          ) ??
          0
        ) + 1
      );


      if (
        triples.get(
          triple
        ) >= 2
      ) {
        return true;
      }
    }


    return false;
  }
  _hasSuspiciousLanguage(text) {
    const lower =
      String(text ?? "")
        .toLocaleLowerCase(
          "tr-TR"
        );


    const patterns = [
      /paradan\s+paraya/u,
      /depozitev/u,
      /depoziteyi/u,
      /sonak\s+randevu/u,
      /kiracıya\s+kiracıya/u,
      /kiracıdan\s+kiracıya/u,
      /kiraya\s+verilen\s+kiracı/u,
      /devam\s+ettirmeye\s+devam/u,
      /\bdeliberately\b/u,
      /retrieved legal/u,
      /system prompt/u,
      /belirsiz\s+belirsizlik/u,
      /sonerede/u,
      /slavery/u,
      /nocebo/u,
      /\bsolely\b/u,

      // Prompt/meta imitation must never be shown to the user.
      /soruyla\s+ilgili\s+kanun\s+parçası/u,
      /soruyla\s+en\s+ilgili\s+kanun\s+parçası/u,
      /soruyu\s+yanıtlayan\s+kanun\s+metni/u,
      /yukarıdaki\s+kanun\s+parçası/u,
      /yukarıdaki\s+kanun\s+metni/u,
      /tam\s+kanun\s+metni/u,
      /seçilen\s+hüküm/u,
    ];


    return patterns.some(
      (pattern) =>
        pattern.test(
          lower
        )
    );
  }


  _hasInventedDuration(
    answer,
    source
  ) {
    const pattern =
      /\b(?:bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|onbeş|otuz|\d+)\s+(?:gün|hafta|ay|yıl|aylık|yıllık)\b/giu;


    const durations =
      String(answer ?? "")
        .match(
          pattern
        ) ??
      [];


    const normalizedSource =
      String(source ?? "")
        .toLocaleLowerCase(
          "tr-TR"
        );


    for (
      const duration of
      durations
    ) {
      if (
        !normalizedSource.includes(
          duration
            .toLocaleLowerCase(
              "tr-TR"
            )
        )
      ) {
        return true;
      }
    }


    return false;
  }


  _isAnswerAcceptable(
    answer,
    article,
    legalContext,
    focusContext
  ) {
    const text =
      String(answer ?? "")
        .trim();


    if (
      !text ||
      text.length < 25
    ) {
      console.warn(
        "[Quality] Empty or too short."
      );

      return false;
    }


    if (
      this._looksTruncated(
        text
      )
    ) {
      console.warn(
        "[Quality] Answer appears truncated."
      );

      return false;
    }


    if (
      this._hasSevereRepetition(
        text
      )
    ) {
      console.warn(
        "[Quality] Repetition detected."
      );

      return false;
    }


    if (
      this._hasSuspiciousLanguage(
        text
      )
    ) {
      console.warn(
        "[Quality] Malformed language detected."
      );

      return false;
    }


    if (
      text.includes(
        "Bu konu hakkında elimdeki kanun metinlerinde yeterli bilgi bulunmamaktadır."
      )
    ) {
      console.warn(
        "[Quality] Phi refused despite retrieved context."
      );

      return false;
    }


    const articleNumbers =
      [
        ...text.matchAll(
          /\b(?:madde\s*)?(\d{3})\b/giu
        ),
      ].map(
        (match) =>
          match[1]
      );


    if (
      articleNumbers.some(
        (number) =>
          number !==
          article
      )
    ) {
      console.warn(
        "[Quality] Wrong article number."
      );

      return false;
    }


    if (
      !new RegExp(
        `\\b${article}\\b`
      ).test(
        text
      )
    ) {
      console.warn(
        "[Quality] Article number missing."
      );

      return false;
    }


    if (
      this._hasInventedDuration(
        text,
        legalContext
      )
    ) {
      console.warn(
        "[Quality] Invented duration."
      );

      return false;
    }


    const sourceOverlap =
      this._calculateSourceOverlap(
        text,
        legalContext
      );


    console.log(
      `[Quality] Source token overlap: ${sourceOverlap.toFixed(3)}`
    );


    if (
      sourceOverlap < 0.70
    ) {
      console.warn(
        "[Quality] Insufficient grounding."
      );

      return false;
    }


    const focusOverlap =
      this._calculateFocusOverlap(
        text,
        focusContext
      );


    console.log(
      `[Quality] Focus token overlap: ${focusOverlap.toFixed(3)}`
    );


    if (
      focusOverlap < 0.25
    ) {
      console.warn(
        "[Quality] Answer is grounded in the article but not focused on the question."
      );

      return false;
    }


    return true;
  }


  // =========================================================
  // SAFE FALLBACK
  // =========================================================

  _buildGroundedFallback(
    article,
    relevantSentences,
    focusContext,
    userMessage
  ) {
    const cleanedFocus =
      String(
        focusContext ??
        ""
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim();


    const cleanedRelevant =
      relevantSentences
        .map(
          (item) =>
            this._cleanLegalSentence(
              item.sentence,
              article
            )
        )
        .map(
          (sentence) =>
            String(sentence ?? "")
              .replace(
                /\s+/g,
                " "
              )
              .trim()
        )
        .filter(Boolean)
        .filter(
          (sentence) =>
            !(
              sentence.includes(">") &&
              sentence.length < 140
            )
        );


    const question =
      String(userMessage ?? "")
        .toLocaleLowerCase(
          "tr-TR"
        );


    const hasNumberedAlternative =
      /\b1\.\s/u.test(
        cleanedFocus
      ) &&
      cleanedRelevant.some(
        (sentence) =>
          /\b2\.\s/u.test(
            sentence
          )
      );


    if (
      cleanedFocus &&
      hasNumberedAlternative
    ) {
      return [
        `TBK Madde ${article}'e göre:`,
        "",
        `• ${cleanedFocus}`,
      ].join("\n");
    }


    const answerSentences = [];


    const addSentence =
      (sentence) => {
        const cleaned =
          String(sentence ?? "")
            .replace(
              /\s+/g,
              " "
            )
            .trim();

        if (!cleaned) {
          return;
        }

        const duplicate =
          answerSentences.some(
            (existing) =>
              existing === cleaned ||
              existing.includes(
                cleaned
              ) ||
              cleaned.includes(
                existing
              )
          );

        if (!duplicate) {
          answerSentences.push(
            cleaned
          );
        }
      };


    const asksNonPayment =
      /\bkira[\p{L}]*/u.test(
        question
      ) &&
      !/ceza/u.test(question) &&
      (
        /ödemez[\p{L}]*/u.test(
          question
        ) ||
        /ödemed[\p{L}]*/u.test(
          question
        ) ||
        /ödenmez[\p{L}]*/u.test(
          question
        ) ||
        /ödenmed[\p{L}]*/u.test(
          question
        ) ||
        /geç\s+öde[\p{L}]*/u.test(
          question
        )
      );


    const asksFixedTermEnd =
      /belirli süreli/u.test(
        question
      ) &&
      (
        /bitti[\p{L}]*/u.test(
          question
        ) ||
        /bitim[\p{L}]*/u.test(
          question
        ) ||
        /süre[\p{L}]*\s+doldu/u.test(
          question
        ) ||
        /çıkar[\p{L}]*/u.test(
          question
        )
      );


    const asksMultipleRights =
      /hangi\s+hak[\p{L}]*/u.test(
        question
      ) ||
      /haklar[\p{L}]*/u.test(
        question
      ) ||
      /neler\s+istey[\p{L}]*/u.test(
        question
      ) ||
      /ne\s+talep\s+ed[\p{L}]*/u.test(
        question
      );


    const asksWearOrDeterioration =
      /yıpran[\p{L}]*/u.test(
        question
      ) ||
      /eskime[\p{L}]*/u.test(
        question
      ) ||
      /bozul[\p{L}]*/u.test(
        question
      ) ||
      /hasar[\p{L}]*/u.test(
        question
      );


    if (asksNonPayment) {
      addSentence(
        cleanedFocus
      );

      for (
        const sentence of
        cleanedRelevant
      ) {
        if (
          /bu süre/u.test(
            sentence
          ) ||
          /süre en az/u.test(
            sentence
          ) ||
          /yazılı bildirimin yapıldığı tarihi izleyen günden/u.test(
            sentence
          )
        ) {
          addSentence(
            sentence
          );
        }
      }
    }


    else if (asksFixedTermEnd) {
      const directRule =
        cleanedRelevant.find(
          (sentence) =>
            /kiraya veren.*sözleşme süresinin bitimine dayanarak.*sona erdiremez/iu.test(
              sentence
            )
        );


      if (directRule) {
        addSentence(
          directRule
        );
      }

      addSentence(
        cleanedFocus
      );


      const longExtensionException =
        cleanedRelevant.find(
          (sentence) =>
            /on yıllık uzama süresi/iu.test(
              sentence
            )
        );


      if (
        longExtensionException
      ) {
        addSentence(
          longExtensionException
        );
      }
    }


    else if (asksWearOrDeterioration) {
      addSentence(
        cleanedFocus
      );


      const normalWearRule =
        cleanedRelevant.find(
          (sentence) =>
            /sözleşmeye uygun kullanma dolayısıyla.*eskimelerden ve bozulmalardan sorumlu değildir/iu.test(
              sentence
            )
        );


      if (normalWearRule) {
        addSentence(
          normalWearRule
        );
      }
    }


    else if (asksMultipleRights) {
      addSentence(
        cleanedFocus
      );

      for (
        const sentence of
        cleanedRelevant
      ) {
        addSentence(
          sentence
        );

        if (
          answerSentences.length >= 3
        ) {
          break;
        }
      }
    }


    else {
      addSentence(
        cleanedFocus
      );
    }


    if (
      answerSentences.length === 0
    ) {
      return (
        "Bu konu hakkında elimdeki kanun metinlerinde yeterli bilgi bulunmamaktadır."
      );
    }


    return [
      `TBK Madde ${article}'e göre:`,
      "",
      ...answerSentences.map(
        (sentence) =>
          `• ${sentence}`
      ),
    ].join("\n");
  }


  // =========================================================
  // PIPELINE
  // =========================================================

  async _runPipeline(
    userMessage,
    history = []
  ) {
    void history;


    console.log(
      "[ChatEngine] Processing legal question."
    );


    const {
      chunks,
      queryEmbedding
    } =
      await this._retrieve(
        userMessage
      );


    if (
      chunks.length === 0
    ) {
      return {
        text:
          "Bu konu hakkında elimdeki kanun metinlerinde yeterli bilgi bulunmamaktadır.",

        chunks: [],

        selectedChunk:
          null,

        generationMode:
          "no-context",
      };
    }


    const rankedSentences =
      await this._rankSentences(
        queryEmbedding,
        chunks
      );


    const article =
      this._chooseArticle(
        rankedSentences,
        userMessage
      );


    if (!article) {
      return {
        text:
          "Bu konu hakkında elimdeki kanun metinlerinde yeterli bilgi bulunmamaktadır.",

        chunks,

        selectedChunk:
          null,

        generationMode:
          "no-context",
      };
    }


    const relevantSentences =
      this._getRelevantSentences(
        rankedSentences,
        article
      );


    if (
      relevantSentences.length === 0
    ) {
      return {
        text:
          "Bu konu hakkında elimdeki kanun metinlerinde yeterli bilgi bulunmamaktadır.",

        chunks,

        selectedChunk:
          null,

        generationMode:
          "no-context",
      };
    }


    const selectedChunk =
      chunks.find(
        (chunk) =>
          this._getArticleNumber(
            chunk.content
          ) ===
          article
      ) ??
      null;


    const {
      legalContext,
      focusContext
    } =
      await this._buildFocusedLegalContext(
        queryEmbedding,
        article,
        relevantSentences
      );


    let answer =
      "";


    try {
      answer =
        await this._generateWithPhi(
          userMessage,
          article,
          legalContext,
          focusContext
        );
    } catch (err) {
      console.error(
        "[ChatEngine] Phi generation error:",
        err.message
      );
    }


    const cleanedAnswer =
      this._trimToCompleteSentences(
        answer
      );


    if (
      this._isAnswerAcceptable(
        cleanedAnswer,
        article,
        legalContext,
        focusContext
      )
    ) {
      console.log(
        "[ChatEngine] Phi answer accepted."
      );


      return {
        text:
          cleanedAnswer,

        chunks,

        selectedChunk,

        generationMode:
          "phi-primary",
      };
    }


    console.warn(
      "[ChatEngine] Phi answer rejected. Using source-grounded fallback."
    );


    return {
      text:
        this._buildGroundedFallback(
          article,
          relevantSentences,
          focusContext,
          userMessage
        ),

      chunks,

      selectedChunk,

      generationMode:
        "fallback",
    };
  }
  // =========================================================
  // SOURCES
  // =========================================================

  _formatSources(
    chunks,
    selectedChunk = null
  ) {
    return chunks.map(
      (chunk) => {
        const article =
          this._getArticleNumber(
            chunk.content
          );


        return {
          title:
            article
              ? `TBK Madde ${article}`
              : chunk.title,

          category:
            chunk.category,

          docId:
            chunk.doc_id,

          chunkIndex:
            chunk.chunk_index,

          article,

          selected:
            selectedChunk
              ? chunk ===
                selectedChunk
              : false,

          score:
            Math.round(
              (
                chunk.semanticScore ??
                chunk.lexicalScore ??
                0
              ) *
                1000
            ) /
            1000,

          semanticScore:
            chunk.semanticScore,

          lexicalScore:
            chunk.lexicalScore,

          hybridScore:
            chunk.hybridScore,
        };
      }
    );
  }


  // =========================================================
  // PUBLIC API
  // =========================================================

  async query(
    userMessage,
    history = []
  ) {
    const result =
      await this._runPipeline(
        userMessage,
        history
      );


    return {
      text:
        result.text,

      sources:
        this._formatSources(
          result.chunks,
          result.selectedChunk
        ),

      generationMode:
        result.generationMode,
    };
  }


  async *queryStream(
    userMessage,
    history = []
  ) {
    const result =
      await this._runPipeline(
        userMessage,
        history
      );


    yield {
      type:
        "sources",

      data:
        this._formatSources(
          result.chunks,
          result.selectedChunk
        ),
    };


    if (
      result.text
    ) {
      yield {
        type:
          "text",

        data:
          result.text,
      };
    }
  }


  // =========================================================
  // CLEANUP
  // =========================================================

  async close() {
    if (
      this.store
    ) {
      this.store.close();

      this.store =
        null;
    }


    if (
      this.embeddingService
    ) {
      try {
        await this.embeddingService.close();
      } catch {
        // ignore
      }

      this.embeddingService =
        null;
    }


    if (
      this.model
    ) {
      try {
        await this.model.unload();
      } catch (err) {
        console.error(
          "[ChatEngine] Model unload error:",
          err
        );
      }

      this.model =
        null;
    }


    this.chatClient =
      null;
  }
}