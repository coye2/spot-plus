// workers/media-gateway/src/index.js — Cloudflare Worker entrypoint for Path 2 OpenSubsonic PoC.
import { handleGatewayRequest } from './gateway.js';

export default {
  async fetch(request, env) {
    return handleGatewayRequest(request, { env });
  },
};
