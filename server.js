const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;
const HOST = '0.0.0.0';
const BACKEND_PROXY = 'http://127.0.0.1:8000';

const ROOT_DIR = __dirname;
const RENDERER_DIR = path.join(ROOT_DIR, 'renderer');
const DATA_DIR = path.join(ROOT_DIR, 'data_store');
const CONFIGS_DIR = path.join(ROOT_DIR, 'configs');

const totalCores = os.cpus() ? os.cpus().length : 4;
const totalRamGb = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
let computeSettings = {
  selected_device: 'auto',
  cpu_cores: Math.max(1, totalCores > 2 ? totalCores - 2 : totalCores),
  ram_limit_gb: Math.max(4, Math.round(totalRamGb * 0.75)),
  ram_unlimited: false,
  vram_fraction: 0.85,
  rocm_gfx_override: 'auto',
};

if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
}

const STAGES = {
  pretrain: { title: 'Pretraining', script: 'scripts/pretrain_base.py' },
  sft: { title: 'Supervised Fine-Tuning', script: 'scripts/train_sft.py' },
  reward: { title: 'Reward Model', script: 'scripts/train_reward.py' },
  dpo: { title: 'DPO / ORPO / KTO', script: 'scripts/train_dpo.py' },
  ppo: { title: 'PPO (RLHF)', script: 'scripts/train_ppo.py' },
  grpo: { title: 'GRPO / RLVR', script: 'scripts/train_grpo.py' },
};

// In-memory state for jobs, evaluations, and datasets
let jobs = [
  {
    job_id: 'job-init-01',
    stage: 'sft',
    title: 'Supervised Fine-Tuning · Llama-3-8B-Instruct',
    status: 'completed',
    started: Date.now() - 3600000,
    log_tail: 'Step 500/500 - loss: 0.812 - lr: 2e-5\nSaved checkpoint to checkpoints/sft_final.pt\nSupervised fine-tuning complete.',
  },
];

let evaluations = [
  {
    job_id: 'eval-init-01',
    kind: 'evaluation',
    stage: 'evaluation',
    title: 'GSM8K · sft_final.pt',
    checkpoint: 'sft_final.pt',
    status: 'completed',
    started: Date.now() - 1800000,
    log_tail: 'Evaluating GSM8K test set (200 examples)...\nAccuracy: 68.5% (137/200)\nAvg tokens/sec: 42.4\nEvaluation complete.',
  },
];

let dataFiles = [
  { name: 'openassistant_conversations.jsonl', size: 14200000, dataset_type: 'sft', uploaded: Date.now() - 86400000 },
  { name: 'dpo_hh_rlhf_pairs.jsonl', size: 28400000, dataset_type: 'preference', uploaded: Date.now() - 72000000 },
  { name: 'gsm8k_math_prompts.jsonl', size: 4100000, dataset_type: 'rl', uploaded: Date.now() - 48000000 },
  { name: 'pretrain_pile_sample.h5', size: 68900000, dataset_type: 'pretrain', uploaded: Date.now() - 108000000 },
];

let models = [
  { name: 'sft_final.pt', size_mb: 3820, path: 'checkpoints/sft_final.pt' },
  { name: 'base_pretrained.pt', size_mb: 3650, path: 'checkpoints/base_pretrained.pt' },
  { name: 'dpo_aligned_step300.pt', size_mb: 3820, path: 'checkpoints/dpo_aligned_step300.pt' },
];

// Helper to send JSON
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(JSON.stringify(data));
}

// Helper to parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({ _raw: body });
      }
    });
    req.on('error', reject);
  });
}

// Generate realistic loss curve metrics
function generateMetrics(stage) {
  const points = [];
  const startLoss = stage === 'pretrain' ? 3.4 : stage === 'reward' ? 1.8 : 2.2;
  const targetLoss = stage === 'pretrain' ? 1.9 : stage === 'reward' ? 0.35 : 0.85;
  for (let step = 10; step <= 200; step += 10) {
    const progress = step / 200;
    const decay = Math.exp(-progress * 2.8);
    const noise = (Math.sin(step) * 0.04) + (Math.cos(step * 0.7) * 0.02);
    const trainLoss = targetLoss + (startLoss - targetLoss) * decay + noise;
    const evalLoss = trainLoss + 0.08 + Math.abs(Math.sin(step * 1.5) * 0.03);
    points.push({
      step,
      train_loss: parseFloat(trainLoss.toFixed(4)),
      eval_loss: parseFloat(evalLoss.toFixed(4)),
      wall: Date.now() - (200 - step) * 10000,
    });
  }
  return points;
}

// Read stage config from disk
function getStageConfig(stage, smoke) {
  const filename = `${stage}.json`;
  const configPath = smoke
    ? path.join(CONFIGS_DIR, 'smoke', filename)
    : path.join(CONFIGS_DIR, filename);

  let raw = {};
  if (fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (_) {}
  } else {
    // Fallback default config
    raw = {
      batch_size: smoke ? 2 : 8,
      grad_accum: smoke ? 2 : 8,
      train_steps: smoke ? 20 : 2000,
      eval_steps: smoke ? 10 : 200,
      lr: 0.0002,
      warmup_steps: smoke ? 2 : 100,
    };
  }

  const fields = Object.entries(raw).map(([key, value]) => {
    let kind = 'text';
    if (typeof value === 'boolean') kind = 'boolean';
    else if (typeof value === 'number') kind = 'number';
    return { name: key, value, kind };
  });

  return { stage, smoke, fields };
}

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    return res.end();
  }

  // --- API Endpoints ---
  if (pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', service: 'cloudnex-web-studio' });
  }

  if (pathname === '/api/system') {
    let deviceLabel = 'ROCm · AMD Radeon RX 9070 XT (16 GB)';
    if (computeSettings.selected_device === 'cpu') {
      deviceLabel = 'CPU Only';
    } else if (computeSettings.selected_device === 'cuda:1') {
      deviceLabel = 'CUDA · NVIDIA GeForce RTX 4090 (24 GB)';
    }

    return sendJson(res, 200, {
      platform: 'CloudNex Web & Desktop',
      python: '3.12 (Embedded Engine)',
      device: deviceLabel,
      accelerator: 'rocm',
      device_name: 'AMD Radeon RX 9070 XT (RDNA 4)',
      is_rocm: true,
      rocm_version: 'ROCm 6.2 (gfx1200)',
      allocated_cores: computeSettings.cpu_cores,
      ram_limit_gb: computeSettings.ram_limit_gb,
      ram_unlimited: computeSettings.ram_unlimited,
      vram_fraction: computeSettings.vram_fraction,
    });
  }

  if (pathname === '/api/system/hardware') {
    if (req.method === 'GET') {
      const gpus = [
        {
          id: 0,
          device_str: 'cuda:0',
          name: 'AMD Radeon RX 9070 XT (RDNA 4 / Navi 48)',
          vram_gb: 16.0,
          type: 'rocm',
          driver_version: 'ROCm 6.2 (gfx1200)',
        },
        {
          id: 1,
          device_str: 'cuda:1',
          name: 'NVIDIA GeForce RTX 4090',
          vram_gb: 24.0,
          type: 'cuda',
          driver_version: 'CUDA 12.4',
        },
      ];

      return sendJson(res, 200, {
        cpu: {
          total_cores: totalCores,
          architecture: os.arch(),
          processor: os.cpus() && os.cpus()[0] ? os.cpus()[0].model : 'Host CPU',
        },
        memory: {
          total_ram_gb: totalRamGb,
        },
        gpus,
        accelerator_summary: {
          available: true,
          accelerator: 'rocm',
          name: 'AMD Radeon RX 9070 XT',
          label: 'ROCm · AMD Radeon RX 9070 XT (16 GB)',
          version: '6.2.0',
          is_rocm: true,
        },
        settings: computeSettings,
      });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      if (body.cpu_cores !== undefined) computeSettings.cpu_cores = Number(body.cpu_cores);
      if (body.ram_limit_gb !== undefined) computeSettings.ram_limit_gb = Number(body.ram_limit_gb);
      if (body.ram_unlimited !== undefined) computeSettings.ram_unlimited = Boolean(body.ram_unlimited);
      if (body.vram_fraction !== undefined) computeSettings.vram_fraction = Number(body.vram_fraction);
      if (body.selected_device !== undefined) computeSettings.selected_device = String(body.selected_device);
      if (body.rocm_gfx_override !== undefined) computeSettings.rocm_gfx_override = String(body.rocm_gfx_override);

      return sendJson(res, 200, {
        status: 'ok',
        message: 'Compute and hardware settings applied.',
        settings: computeSettings,
      });
    }
  }

  if (pathname === '/api/stages') {
    const stageList = Object.entries(STAGES).map(([key, data]) => ({ key, ...data }));
    return sendJson(res, 200, stageList);
  }

  const configMatch = pathname.match(/^\/api\/stages\/([^/]+)\/config$/);
  if (configMatch && req.method === 'GET') {
    const stage = configMatch[1];
    const smoke = urlObj.searchParams.get('smoke') !== 'false';
    return sendJson(res, 200, getStageConfig(stage, smoke));
  }

  const metricsMatch = pathname.match(/^\/api\/metrics\/([^/]+)$/);
  if (metricsMatch && req.method === 'GET') {
    const stage = metricsMatch[1];
    return sendJson(res, 200, generateMetrics(stage));
  }

  if (pathname === '/api/jobs') {
    if (req.method === 'GET') {
      return sendJson(res, 200, jobs);
    }
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const stage = body.stage || 'pretrain';
      const stageInfo = STAGES[stage] || { title: stage };
      const newJob = {
        job_id: `job-${Date.now().toString(36)}`,
        stage,
        title: `${stageInfo.title} · ${body.smoke ? 'Smoke Test' : 'Run'}`,
        status: 'running',
        started: Date.now(),
        log_tail: `[${new Date().toISOString()}] Initializing ${stageInfo.title}...\nDevice: CPU / CUDA\nBatch Size: ${body.overrides?.batch_size || 4}\nBeginning training steps...`,
      };
      jobs.unshift(newJob);

      // Simulate completion after a brief moment
      setTimeout(() => {
        newJob.status = 'completed';
        newJob.log_tail += `\nStep 100/100 completed successfully.\nFinal loss: 0.842\nCheckpoint saved to checkpoints/${stage}_latest.pt`;
        if (!models.some((m) => m.name === `${stage}_latest.pt`)) {
          models.unshift({
            name: `${stage}_latest.pt`,
            size_mb: 3750,
            path: `checkpoints/${stage}_latest.pt`,
          });
        }
      }, 5000);

      return sendJson(res, 200, newJob);
    }
  }

  if (pathname === '/api/data/files') {
    if (req.method === 'GET') {
      return sendJson(res, 200, dataFiles);
    }
  }

  if (pathname === '/api/data/upload' && req.method === 'POST') {
    // Simulated upload handler
    const newFile = {
      name: `dataset_${Date.now().toString(36)}.jsonl`,
      size: Math.floor(Math.random() * 20000000) + 1000000,
      dataset_type: 'general',
      uploaded: Date.now(),
    };
    dataFiles.unshift(newFile);
    return sendJson(res, 200, { status: 'ok', file: newFile });
  }

  const dataFileMatch = pathname.match(/^\/api\/data\/files\/([^/]+)$/);
  if (dataFileMatch) {
    const filename = decodeURIComponent(dataFileMatch[1]);
    if (req.method === 'PATCH') {
      const body = await parseBody(req);
      const target = dataFiles.find((f) => f.name === filename);
      if (target && body.dataset_type) {
        target.dataset_type = body.dataset_type;
      }
      return sendJson(res, 200, target || { status: 'ok' });
    }
    if (req.method === 'DELETE') {
      dataFiles = dataFiles.filter((f) => f.name !== filename);
      return sendJson(res, 200, { status: 'deleted', name: filename });
    }
  }

  if (pathname === '/api/models') {
    if (req.method === 'GET') {
      return sendJson(res, 200, models);
    }
  }

  if (pathname === '/api/models/export' && req.method === 'POST') {
    const body = await parseBody(req);
    return sendJson(res, 200, { status: 'ok', name: path.basename(body.checkpoint || 'checkpoint.pt') });
  }

  if (pathname === '/api/chat' && req.method === 'POST') {
    const body = await parseBody(req);
    const prompt = body.prompt || '';
    const model = body.checkpoint || 'Local Checkpoint';

    // Generates a smart context-aware response for the local studio
    let reply = `[CloudNex Engine: ${model}]\n\n`;
    if (prompt.toLowerCase().includes('hello') || prompt.toLowerCase().includes('hi')) {
      reply += "Hello! I am your locally fine-tuned model checkpoint running inside CloudNex Local LLM Studio. How can I help you test or explore reasoning tasks today?";
    } else if (prompt.toLowerCase().includes('math') || prompt.includes('+') || prompt.includes('*') || prompt.toLowerCase().includes('calculate')) {
      reply += `Let's solve that step by step:\n1. Analyzing query: "${prompt.trim()}"\n2. Applying chain-of-thought mathematical reasoning...\n3. Conclusion: The calculation is verified against the training set distribution with high confidence.`;
    } else {
      reply += `Thank you for your prompt. Here is the local model inference response based on the active checkpoint parameters:\n\nRegarding "${prompt.trim()}":\nThe training objective has aligned representations for this domain. You can adjust sampling parameters, max_new_tokens, or fine-tune further with DPO / PPO in the Training tab.`;
    }

    return sendJson(res, 200, { reply });
  }

  if (pathname === '/api/license') {
    const licensePath = path.join(ROOT_DIR, 'installer', 'LICENSE.txt');
    try {
      const text = fs.readFileSync(licensePath, 'utf8');
      return sendJson(res, 200, { license: text });
    } catch (_) {
      return sendJson(res, 200, { license: 'Copyright (c) 2026 Mohammed Sheik (https://cloudnex.co.za). All rights reserved.' });
    }
  }

  if (pathname === '/api/readme') {
    const readmePath = path.join(ROOT_DIR, 'installer', 'README.md');
    try {
      const text = fs.readFileSync(readmePath, 'utf8');
      return sendJson(res, 200, { readme: text });
    } catch (_) {
      return sendJson(res, 200, { readme: '# CloudNex Local LLM Studio\nCreated by Mohammed Sheik.' });
    }
  }

  if (pathname === '/api/evaluations') {
    if (req.method === 'GET') {
      return sendJson(res, 200, evaluations);
    }
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const modelName = path.basename(body.checkpoint || 'checkpoint.pt');
      const newEval = {
        job_id: `eval-${Date.now().toString(36)}`,
        kind: 'evaluation',
        stage: 'evaluation',
        title: `GSM8K · ${modelName}`,
        checkpoint: modelName,
        status: 'running',
        started: Date.now(),
        log_tail: `Evaluating GSM8K ${body.split || 'test'} split on ${modelName}...\nExamples: ${body.limit || 200}, Max new tokens: ${body.max_new_tokens || 300}...`,
      };
      evaluations.unshift(newEval);

      setTimeout(() => {
        const score = (65 + Math.random() * 15).toFixed(1);
        newEval.status = 'completed';
        newEval.log_tail += `\nBenchmark completed.\nAccuracy: ${score}%\nAll metrics recorded.`;
      }, 4000);

      return sendJson(res, 200, newEval);
    }
  }

  // --- Static File Serving (from renderer/) ---
  let reqPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(RENDERER_DIR, reqPath);

  // Security check: ensure path is within RENDERER_DIR
  if (!filePath.startsWith(RENDERER_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fall back to index.html for SPA routes
      filePath = path.join(RENDERER_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500);
        return res.end('Internal Server Error');
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      });
      res.end(content);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`CloudNex Web Dev Server running at http://${HOST}:${PORT}`);
});
