import { createPublicClient, tiramisu, query } from '@arkiv-network/sdk';

const client = createPublicClient({ chain: tiramisu });

async function check() {
  console.log("Interrogo Tiramisu...");
  try {
    const res = await query(client, {
      where: { createdBy: "0x8458cF7ED1f5CeA1fe2cD1aa34E67A53a88Bf38e" }
    });
    console.log(`Trovate: ${res.entities.length} entità attive create da te.`);
    res.entities.forEach(e => console.log(`- ID: ${e.key} | Scade al blocco: ${e.expiresAt}`));
  } catch (err) {
    console.error("Errore di rete:", err);
  }
}
check();