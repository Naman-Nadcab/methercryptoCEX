import http from 'http';
import { URL } from 'url';
import { addressManager } from '../services/AddressManager';
import { logger } from '../utils/logger';

const PORT = process.env.INDEXER_API_PORT || 4001;

export function startApiServer(indexerManager: any): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const path = url.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // GET /health - Health check
      if (path === '/health' && req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
      }

      // GET /stats - Get indexer statistics
      if (path === '/stats' && req.method === 'GET') {
        const stats = indexerManager.getStats();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, data: stats }));
        return;
      }

      // POST /address/generate - Generate deposit address for user
      if (path === '/address/generate' && req.method === 'POST') {
        const body = await getRequestBody(req);
        const { userId, chainId } = body;

        if (!userId) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'userId is required' }));
          return;
        }

        if (chainId) {
          // Generate for specific chain
          const result = await addressManager.generateAddressForUser(userId, chainId);
          
          // Notify indexer to watch this address
          if (result.created) {
            await indexerManager.addWatchedAddress(chainId, result.address);
          }

          res.writeHead(200);
          res.end(JSON.stringify({ success: true, data: result }));
        } else {
          // Generate for all chains
          const addresses = await addressManager.generateAddressesForAllChains(userId);
          
          // Notify indexers to watch these addresses
          for (const [chain, address] of Object.entries(addresses)) {
            await indexerManager.addWatchedAddress(chain, address);
          }

          res.writeHead(200);
          res.end(JSON.stringify({ success: true, data: { addresses } }));
        }
        return;
      }

      // GET /address/:userId - Get user addresses
      if (path.startsWith('/address/') && req.method === 'GET') {
        const userId = path.split('/')[2];
        
        if (!userId) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'userId is required' }));
          return;
        }

        const addresses = await addressManager.getUserAddresses(userId);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, data: { addresses } }));
        return;
      }

      // POST /watch - Add address to watch list
      if (path === '/watch' && req.method === 'POST') {
        const body = await getRequestBody(req);
        const { chainId, address } = body;

        if (!chainId || !address) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'chainId and address are required' }));
          return;
        }

        const success = await indexerManager.addWatchedAddress(chainId, address);
        res.writeHead(200);
        res.end(JSON.stringify({ success }));
        return;
      }

      // 404 Not Found
      res.writeHead(404);
      res.end(JSON.stringify({ success: false, error: 'Not found' }));

    } catch (error) {
      logger.error('API error', { path, error });
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
    }
  });

  server.listen(PORT, () => {
    logger.info(`Indexer API server listening on port ${PORT}`);
  });

  return server;
}

function getRequestBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}
