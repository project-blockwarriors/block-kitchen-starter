import { createInterface } from 'node:readline';
import { KitchenAgent } from './agent/harness.ts';
const agent = new KitchenAgent();
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.type === 'prepare' && message.version === 1)
    console.log(JSON.stringify({ type: 'ready', version: 1, nonce: message.nonce }));
  else if (message.type === 'model-response') agent.respond(message);
  else if (message.type === 'observation') {
    const { action, requests, trace } = agent.step(message.observation);
    console.log(JSON.stringify({ type: 'action', action }));
    for (const request of requests) console.log(JSON.stringify(request));
    console.error(JSON.stringify(trace));
  }
}
