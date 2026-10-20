import { AxiosError } from 'axios'

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number }
}

/** Graph errors carry the useful part in body.error.message — surface that, not "Request failed". */
export function describeGraphError(error: unknown): string {
  const axiosError = error as AxiosError<GraphErrorBody>
  const metaMessage = axiosError?.response?.data?.error?.message
  if (metaMessage) return metaMessage
  if (axiosError?.message) return axiosError.message
  return 'error desconocido'
}

/**
 * The Graph error codes that mean our app can no longer act on the number, as
 * opposed to a blip (timeout, 5xx, rate limit) that must not be read as a drop:
 *
 *   100/33  the object "does not exist or cannot be loaded due to missing
 *           permissions" — what a number returns once the business removed us
 *   190     the business token is invalid or expired
 *   200, 10 the token lost the WhatsApp permission
 *
 * Returns the code as a short label ("GRAPH_100_33"), or null for anything else.
 */
export function connectionLostCode(error: unknown): string | null {
  const graph = (error as AxiosError<GraphErrorBody>)?.response?.data?.error
  if (!graph?.code) return null
  if (graph.code === 100 && graph.error_subcode === 33) return 'GRAPH_100_33'
  if (graph.code === 190 || graph.code === 200 || graph.code === 10) return `GRAPH_${graph.code}`
  return null
}
