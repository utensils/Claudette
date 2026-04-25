import { createContext } from "react";

/**
 * True while the consumer subtree is being rendered as part of a live
 * typewriter stream (or its drain phase). The `code` markdown override reads
 * this to decide whether to dispatch the worker for syntax highlighting —
 * during streaming the input changes per RAF tick and any in-flight highlight
 * is stale before it returns, so the override skips the worker entirely and
 * renders plain. Highlighting kicks in once the message finalizes.
 */
export const StreamingContext = createContext(false);
