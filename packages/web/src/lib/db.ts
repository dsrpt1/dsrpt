import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL || ''

let sql: ReturnType<typeof postgres> | null = null

export function getDB() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL not configured')
  }
  if (!sql) {
    sql = postgres(DATABASE_URL, {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
    })
  }
  return sql
}
