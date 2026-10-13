/** One page of a list, in the shape every paginated admin listing returns. */
export interface Page<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/** Resolves the requested page (1-based) into Prisma's skip/take. */
export function pageWindow(
  query: { page?: number; pageSize?: number },
  defaultPageSize: number,
): { page: number; pageSize: number; skip: number; take: number } {
  const page = query.page && query.page > 0 ? query.page : 1
  const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : defaultPageSize
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

export function toPage<T>(data: T[], total: number, page: number, pageSize: number): Page<T> {
  return { data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}
