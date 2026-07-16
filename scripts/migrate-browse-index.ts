import { migrateBrowseIndexToCompressedV2 } from "../src/server/storage/browse-diagrams";

const entryCount = await migrateBrowseIndexToCompressedV2();
console.log(`Compressed browse index is ready (${entryCount} entries).`);
