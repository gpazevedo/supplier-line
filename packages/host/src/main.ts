import { createHostServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);

createHostServer().listen(port, () => console.log(`host listening on :${port}`));
