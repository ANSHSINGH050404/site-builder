import { prisma } from "db";
import fs from "fs";

async function main() {
  const c = await prisma.conversation.findMany({
    where: { projectId: "03b66ef7-ba58-4cdf-82a4-2ebf1f6139d2" },
    orderBy: { createdAt: "asc" },
  });

  const out = c
    .map(
      (x) =>
        `[ID: ${x.id}] [${x.from}] [${x.type}]\n${x.contents.substring(0, 1000)}\n---`,
    )
    .join("\n");
  fs.writeFileSync("out.txt", out);
  console.log("Wrote out.txt");
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
