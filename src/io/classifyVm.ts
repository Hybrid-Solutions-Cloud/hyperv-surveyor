/**
 * Tier auto-classification from a VM name. [TOOL] heuristic, flagged for review whenever it fires.
 *
 * The name is split into tokens at every character that is not a letter or digit, so database
 * words only match as whole tokens or in a few recognised prefixed and suffixed forms (prddb01,
 * app_db_01, SQLPROD01). Substring matching made aurora2, sqlite-tool and mongoose-web databases,
 * cards1 a VDI host, and DC1-WEB01, mintprod01 and blueprint-api infrastructure.
 *
 * The guest OS never makes a VM a database, because Oracle Linux, Oracle Enterprise Linux and
 * Oracle Solaris say nothing about what runs on them. The only OS strings that count are real
 * database appliances.
 */
import type { TierId } from '../engine/types'

/** Environment and role prefixes seen in front of a role word, as in prd-db01 written prddb01. */
const ENV = '(?:prd|prod|dev|tst|test|uat|qa|stg|dr|app)'
const DIGITS = '(?:\\d+[a-z]?)?'

const DB_TOKEN = [
  new RegExp(`^[a-z]*sql${DIGITS}$`), // sql01, mssql, mysql, pgsql, prodsql01
  /^sql\d+[a-z]*$/, // sql2019ent
  new RegExp(`^sql(?:${ENV.slice(3, -1)}|srv|svr|server|clu|clus|cluster|ag|node|db|rs|as|is)${DIGITS}$`), // sqlprod01, sqlsrv1
  new RegExp(`^[a-z]*db${DIGITS}$`), // db, db01, db2, prddb01, mariadb, mongodb
  new RegExp(`^db\\d*(?:${ENV.slice(3, -1)}|srv|svr|server|s|clu|node)${DIGITS}$`), // dbprod01, db2prod, dbs1
  new RegExp(`^[a-z]*oracle${DIGITS}$`),
  new RegExp(`^oracle(?:${ENV.slice(3, -1)}|srv|db)${DIGITS}$`),
  new RegExp(`^[a-z]*orcl${DIGITS}$`),
  new RegExp(`^${ENV}?ora\\d+[a-z]?$`), // ora19c, prdora01 (not aurora2)
  new RegExp(`^[a-z]*postgres(?:ql)?${DIGITS}$`),
  new RegExp(`^[a-z]*sybase${DIGITS}$`),
  new RegExp(`^[a-z]*mongo${DIGITS}$`), // mongo01 (not mongoose)
]

const VDI_TOKEN = [
  new RegExp(`^${ENV}?vdi${DIGITS}$`),
  /^[a-z]*ctx[a-z]{0,4}\d*$/,
  /citrix/,
  /xendesktop/,
  new RegExp(`^${ENV}?(?:wvd|avd)${DIGITS}$`),
  new RegExp(`^${ENV}?rds(?:h|host|sh|cb|gw)?\\d+[a-z]?$`), // rds01 (not cards1)
  /^rds(?:h|host|sh|cb|gw)$/,
  /^session(?:host)?\d*$/,
]

const INFRA_TOKEN = [
  /^domain(?:controller|ctrl)?\d*$/,
  /^[a-z]{0,6}dns\d*$/,
  /^dns[a-z]{0,6}\d*$/,
  /dhcp/,
  new RegExp(`^${ENV}?ntp(?:srv|svr|server)?\\d*$`), // ntp01 (not mintprod01)
  new RegExp(`^${ENV}?print(?:srv|svr|server|er|ers)?\\d*$`), // print01 (not blueprint)
  new RegExp(`^${ENV}?(?:jump|jmp)(?:box|host|srv|svr|server)?\\d*$`),
  /bastion/,
  /wsus/,
  /^ad\d+$/,
]

/** A domain controller token: dc01, addc01, prddc1. */
const DC_TOKEN = new RegExp(`^(?:ad|corp|${ENV.slice(3, -1)})?dc\\d+[a-z]?$`)

/** OS strings that do identify a database appliance. */
const DATABASE_APPLIANCE_OS = /(oracle\s+database\s+appliance|exadata|sql\s+server\s+appliance)/i

/** Splits a VM name into lowercase tokens at every non-alphanumeric character. */
export function nameTokens(name: string): string[] {
  return name
    // "oracle-linux-01" names the operating system, not an Oracle database.
    .replace(/oracle[\s_-]*(?:enterprise[\s_-]*)?(?:linux|solaris)/gi, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const any = (patterns: RegExp[], token: string) => patterns.some((pattern) => pattern.test(token))
const numeric = (token: string | undefined) => !!token && /^\d+$/.test(token)
/** Environment words that may follow a domain-controller token, as in dc01-prod. "app" is a role, not an environment. */
const ENV_TOKEN = /^(?:prd|prod|dev|tst|test|uat|qa|stg|dr)\d*$/

export function isDatabaseName(name: string): boolean {
  const tokens = nameTokens(name)
  return tokens.some((token, index) => any(DB_TOKEN, token) || (token === 'ora' && numeric(tokens[index + 1])))
}

export function isVdiName(name: string, guestOs = ''): boolean {
  if (nameTokens(name).some((token) => any(VDI_TOKEN, token))) return true
  // A VDI product name in the OS string is still a reliable signal; generic words are not.
  return /\b(citrix|xendesktop)\b/i.test(guestOs)
}

export function isInfrastructureName(name: string): boolean {
  const tokens = nameTokens(name)
  return tokens.some((token, index) => {
    if (any(INFRA_TOKEN, token)) return true
    // DC1 in DC1-WEB01 is a site prefix. A dc token counts only when nothing but numbers or an
    // environment word follows it.
    if (DC_TOKEN.test(token) || (token === 'dc' && numeric(tokens[index + 1]))) {
      return tokens.slice(index + 1).every((rest) => numeric(rest) || ENV_TOKEN.test(rest))
    }
    return false
  })
}

/**
 * Auto-classification. Anything promoted out of "general" is flagged for review. Only the VM name
 * and, for database appliances and VDI products, the guest OS can assign a tier. Size says a VM
 * is big, not what it runs, so size only raises needsSizeReview.
 */
export function classify(name: string, guestOs: string): TierId {
  if (isDatabaseName(name) || DATABASE_APPLIANCE_OS.test(guestOs)) return 'database'
  if (isVdiName(name, guestOs)) return 'vdi'
  if (isInfrastructureName(name)) return 'infrastructure'
  return 'general'
}
