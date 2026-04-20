import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import { config } from './config.js';
import { router } from './routes/convert.js';
import { startCleanupLoop } from './utils/cleanup.js';

const app = express();

app.disable('x-powered-by');
app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin,
    credentials: false,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'moesconverter-backend' });
});

app.use('/api', router);

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

app.use(
  (err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[error]', err);
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message || 'Internal server error' });
  },
);

startCleanupLoop();

app.listen(config.port, () => {
  console.log(`[backend] MoesConverter API listening on :${config.port}`);
  console.log(`[backend] uploads -> ${config.uploadDir}`);
  console.log(`[backend] outputs -> ${config.outputDir}`);
});
