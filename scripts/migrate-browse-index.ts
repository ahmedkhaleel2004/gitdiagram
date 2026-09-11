import { migrateBrowseIndexToAtomicV3 } from "../src/server/storage/browse-diagrams";

const entryCount = await migrateBrowseIndexToAtomicV3();
console.log(`Atomic browse index is ready (${entryCount} entries).`);
