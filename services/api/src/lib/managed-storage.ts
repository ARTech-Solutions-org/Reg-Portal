import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

export class ManagedStorageError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message);
    this.name = "ManagedStorageError";
  }
}

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new ManagedStorageError("Persistent PDF storage is unavailable in this runtime.");
    }
    s3Client = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return s3Client;
}

const getBucketName = () => {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) throw new ManagedStorageError("Persistent PDF storage is unavailable in this runtime.");
  return bucket;
};

const downloadCache = new Map<string, { bytes: Uint8Array, expiresAt: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache for PDFs

/** Upload bytes to a project-scoped durable object path using the S3 API. */
export async function uploadManagedObject(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  if (!/^[\x20-\x7e]+$/.test(path)) throw new ManagedStorageError("The storage object path is invalid.", 400);
  if (contentType !== "application/pdf") throw new ManagedStorageError("Only PDF templates can be stored.", 400);

  const client = getS3Client();
  try {
    await client.send(new PutObjectCommand({
      Bucket: getBucketName(),
      Key: path,
      Body: bytes,
      ContentType: contentType,
    }));
    // Clear cache to ensure next download uses the fresh template
    downloadCache.delete(path);
  } catch (error) {
    console.error("S3 Upload Error:", error);
    throw new ManagedStorageError("The PDF upload to persistent storage did not complete.");
  }
}


/** Download a project object through the S3 API. */
export async function downloadManagedObject(path: string): Promise<Uint8Array> {
  if (!/^[\x20-\x7e]+$/.test(path)) throw new ManagedStorageError("The storage object path is invalid.", 400);

  const cached = downloadCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.bytes;
  }

  const client = getS3Client();
  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: getBucketName(),
      Key: path,
    }));

    if (!response.Body) {
      throw new ManagedStorageError("The saved PDF template could not be downloaded.");
    }

    const declaredLength = response.ContentLength;
    if (typeof declaredLength === "number" && declaredLength > 20 * 1024 * 1024) {
      throw new ManagedStorageError("The saved PDF template exceeds the 20 MB limit.", 413);
    }
    
    // AWS SDK v3 Body is a stream in Node.js
    const bytes = await response.Body.transformToByteArray();
    
    if (bytes.length > 20 * 1024 * 1024) throw new ManagedStorageError("The saved PDF template exceeds the 20 MB limit.", 413);
    if (bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
      throw new ManagedStorageError("The saved object is not a supported PDF template.", 502);
    }

    // Save to cache
    downloadCache.set(path, { bytes, expiresAt: Date.now() + CACHE_TTL_MS });

    return bytes;
  } catch (error: any) {
    console.error("S3 Download Error:", error);
    if (error.name === "NoSuchKey") {
      throw new ManagedStorageError("The saved PDF template could not be found.", 404);
    }
    throw new ManagedStorageError("The saved PDF template could not be downloaded.");
  }
}
