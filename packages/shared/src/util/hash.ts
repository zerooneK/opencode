import { createHash } from "crypto"

export namespace Hash {
  export function fast(input: string | Buffer): string {
    const data = input instanceof Buffer ? new Uint8Array(input) : input
    return createHash("sha1").update(data).digest("hex")
  }
}
