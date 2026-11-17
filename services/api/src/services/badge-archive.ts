import { Zip, ZipPassThrough } from "fflate";

export async function* streamBadgeArchive(filenames: string[], render: (index: number) => Promise<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });

  try {
    for (const [index, filename] of filenames.entries()) {
      const pdf = await render(index);
      const entry = new ZipPassThrough(filename);
      zip.add(entry);
      entry.push(pdf, true);
      yield* chunks.splice(0);
    }
    zip.end();
    yield* chunks;
  } finally {
    zip.terminate();
  }
}
