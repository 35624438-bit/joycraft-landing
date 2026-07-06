import { routeModel, MODEL_NAMES, UCLOUD_MODELS } from '../../lib/model-router.js';
const TIER_LIMITS = { free:{rpm:5,monthly:100}, grow:{rpm:20,monthly:1000}, pro:{rpm:60,monthly:5000}, scale:{rpm:120,monthly:20000}, enterprise:{rpm:300,monthly:100000} };
const rateStore = new Map();

const PLATFORM_RULES = {
  shopee: "Shopee rules: Product title max 120 chars. No external links, phone numbers, or WhatsApp. No fake discounts. No competitor brand names. Use Shopee-standard hashtags.",
  lazada: "Lazada rules: Product title max 60 chars for some categories. No COD-only claims. No external contact info. No 100% original guarantee claims without cert. Product descriptions must be factual.",
  tiktok: "TikTok Shop rules: Caption max 2,200 chars. No engagement bait ('comment for link', 'tag 3 friends'). No medical claims. No off-platform payment references. Hashtag limit 8.",
};

const STYLE_GUIDES = {
  soft: "Tone: Friendly and lifestyle-oriented. Use emojis naturally. Lead with benefits, not specs.",
  hard: "Tone: Direct and sales-driven. Lead with price and urgency. Use numbers and social proof.",
  minimal: "Tone: Short and punchy. Each line under 15 words. No filler words.",
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({success:false,error:'Method not allowed'});
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({success:false,error:'Missing API key'});
  const apiKey = authHeader.slice(7);
  const { VERCEL_KV_URL, VERCEL_KV_TOKEN } = process.env;
  let keyData, tier = 'free';
  try {
    const kvRes = await fetch(`${VERCEL_KV_URL}/get/apikey:${apiKey}`, {headers:{Authorization:`Bearer ${VERCEL_KV_TOKEN}`}});
    const d = await kvRes.json();
    if (!d.result) return res.status(401).json({success:false,error:'Invalid key'});
    keyData = JSON.parse(d.result);
    tier = keyData.tier || 'free';
  } catch { return res.status(503).json({success:false,error:'Auth unavailable'}); }
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;
  const wKey = 'rl:'+apiKey+':'+Math.floor(Date.now()/60000);
  let rpm = rateStore.get(wKey) || 0;
  if (rpm >= limits.rpm) return res.status(429).json({success:false,error:'Rate limit: '+limits.rpm+'/min'});
  rateStore.set(wKey, rpm+1);
  const { productName, description, platform, language, style, category, imageBase64, imageMimeType } = req.body || {};
  if (!productName) return res.status(400).json({success:false,error:'productName required'});

  const modelName = routeModel();
  let caption, tags, detectedCategory, usedModel = modelName;

  try {
    const r = await doGen({ productName, description, platform, language, style, category, imageBase64, imageMimeType,
      modelName,
      apiKeys: { ucloud: process.env.UCLOUD_API_KEY, openai: process.env.OPENAI_API_KEY, qwen: process.env.QWEN_API_KEY }
    });
    caption = r.caption; tags = r.tags; detectedCategory = r.detectedCategory;
  } catch {
    // Fallback: 同一模型重试一次（偶尔网络抖动）
    try {
      const fb = await doGen({ productName, description, platform, language, style, category, imageBase64, imageMimeType,
        modelName,
        apiKeys: { ucloud: process.env.UCLOUD_API_KEY }
      });
      caption = fb.caption; tags = fb.tags; detectedCategory = fb.detectedCategory;
      usedModel = modelName + ' (retry)';
    } catch {
      // Last resort: OpenAI GPT-4o-mini
      if (process.env.OPENAI_API_KEY) {
        try {
          const fb2 = await doGen({ productName, description, platform, language, style, category, imageBase64, imageMimeType,
            modelName: 'gpt-4o-mini',
            apiKeys: { openai: process.env.OPENAI_API_KEY }
          });
          caption = fb2.caption; tags = fb2.tags; detectedCategory = fb2.detectedCategory;
          usedModel = 'gpt-4o-mini (fallback)';
        } catch {
          return res.status(502).json({success:false,error:'All models down'});
        }
      } else {
        return res.status(502).json({success:false,error:'All models down'});
      }
    }
  }

  return res.status(200).json({success:true,data:{caption,tags,detectedCategory:detectedCategory||null,risk:null,model:usedModel}});
}

async function doGen({ productName, description, platform, language, style, category, modelName, apiKeys, imageBase64, imageMimeType }) {
  const text = productName + (description ? ': ' + description : '');
  const ucloudKey = apiKeys.ucloud || process.env.UCLOUD_API_KEY;

  // UCloud 模型（默认路径）
  if (modelName.includes('/') || modelName.includes('flash')) {
    return callUModelVerse(text, platform, language, style, category, modelName, ucloudKey, imageBase64, imageMimeType);
  }
  // Legacy OpenAI fallback（保留旧 Key 的最终保底）
  if (modelName.startsWith('gpt')) {
    return callOpenAI(text, platform, language, style, category, modelName, apiKeys.openai);
  }
  // Legacy Qwen fallback
  if (modelName.startsWith('qwen')) {
    return callQwen(text, platform, language, style, category, modelName, apiKeys.qwen);
  }
  // Default: UCloud
  return callUModelVerse(text, platform, language, style, category, modelName, ucloudKey, imageBase64, imageMimeType);
}

async function callOpenAI(text,platform,language,style,category,model,apiKey) {
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),25000);
  const platformRule = PLATFORM_RULES[platform] || PLATFORM_RULES.shopee;
  const styleGuide = STYLE_GUIDES[style] || STYLE_GUIDES.soft;
  const sys='You are an ecommerce copywriter specialized in Southeast Asian platforms. Generate product listing copy in '+(language||'en')+' for '+(platform||'Shopee')+'. Category: '+(category||'general')+'. '+styleGuide+' '+platformRule+' Output STRICT JSON: {"caption":"...","tags":{"trending":[],"longtail":[],"brand":[]},"detectedCategory":"..."}.';
  const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify({model,messages:[{role:'system',content:sys},{role:'user',content:text}],max_tokens:600,temperature:0.8}),signal:c.signal});
  clearTimeout(t);
  const d=await r.json(); const content=d.choices?.[0]?.message?.content||'';
  const p=JSON.parse(content); return {caption:p.caption||'',tags:p.tags||{},detectedCategory:p.detectedCategory||null};
}

async function callQwen(text,platform,language,style,category,model,apiKey) {
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),25000);
  const platformRule = PLATFORM_RULES[platform] || PLATFORM_RULES.shopee;
  const styleGuide = STYLE_GUIDES[style] || STYLE_GUIDES.soft;
  const sys='You are an ecommerce copywriter specialized in Southeast Asian platforms. Generate product listing copy in '+(language||'en')+' for '+(platform||'Shopee')+'. Category: '+(category||'general')+'. '+styleGuide+' '+platformRule+' Use local idioms and natural phrasing. Output STRICT JSON: {"caption":"...","tags":{"trending":[],"longtail":[],"brand":[]},"detectedCategory":"..."}.';
  const r=await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify({model,messages:[{role:'system',content:sys},{role:'user',content:text}],max_tokens:600,temperature:0.8}),signal:c.signal});
  clearTimeout(t);
  const d=await r.json(); const content=d.choices?.[0]?.message?.content||'';
  const p=JSON.parse(content); return {caption:p.caption||'',tags:p.tags||{},detectedCategory:p.detectedCategory||null};
}

async function callUModelVerse(text, platform, language, style, category, modelId, apiKey, imageBase64, imageMimeType) {
  const base = process.env.UCLOUD_API_BASE || 'https://api-sg.umodelverse.ai';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  const platformRule = PLATFORM_RULES[platform] || PLATFORM_RULES.shopee;
  const styleGuide = STYLE_GUIDES[style] || STYLE_GUIDES.soft;
  const sys = `You are an ecommerce copywriter specialized in Southeast Asian platforms. Generate product listing copy in ${language || 'en'} for ${platform || 'Shopee'}. Category: ${category || 'general'}. ${styleGuide} ${platformRule} Output STRICT JSON: {"caption":"...","tags":{"trending":[],"longtail":[],"brand":[]},"detectedCategory":"..."}.`;

  let messages;
  if (imageBase64 && imageMimeType) {
    modelId = 'gemini-2.5-flash';
    messages = [
      { role: 'system', content: sys },
      { role: 'user', content: [
        { type: 'text', text: text },
        { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } }
      ]}
    ];
  } else {
    messages = [
      { role: 'system', content: sys },
      { role: 'user', content: text }
    ];
  }

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages, max_tokens: 600, temperature: 0.8 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const eb = await res.json().catch(() => ({}));
      throw new Error(eb.error?.message || `UCloud API error: ${res.status}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = { caption: content, tags: {}, detectedCategory: null }; }
    return { caption: parsed.caption || '', tags: parsed.tags || {}, detectedCategory: parsed.detectedCategory || null };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
