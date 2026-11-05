import { describe, expect, it } from 'vitest'
import { classify, nameTokens } from './classifyVm'

const WINDOWS = 'Microsoft Windows Server 2022 (64-bit)'

describe('VM name tokens', () => {
  it('splits at every character that is not a letter or digit', () => {
    expect(nameTokens('app_db_01')).toEqual(['app', 'db', '01'])
    expect(nameTokens('DC1-WEB01')).toEqual(['dc1', 'web01'])
  })
})

describe('database classification', () => {
  it.each(['DB01', 'PRDDB01', 'app_db_01', 'ORCL01', 'prod-sql-01', 'SQLPROD01', 'mssql-02', 'mysql1', 'pgsql-01', 'postgres-a', 'mariadb01', 'db2-prod', 'sybase1', 'mongo-01', 'MongoDB01', 'ora19c', 'app-ora-01', 'oracle-prod-1', 'dbs1'])('%s is a database', (name) => {
    expect(classify(name, WINDOWS)).toBe('database')
  })

  it.each(['aurora2', 'sqlite-tool', 'mongoose-web', 'jdbc-proxy', 'flora1', 'app01'])('%s is not a database', (name) => {
    expect(classify(name, WINDOWS)).not.toBe('database')
  })

  it.each(['Oracle Solaris 11 (64-bit)', 'Oracle Enterprise Linux 7', 'OracleLinux 8', 'Oracle Linux 8 (64-bit)'])('the %s guest OS stays general', (os) => {
    expect(classify('app1', os)).toBe('general')
  })

  it('does not treat an OS name inside the VM name as a database', () => {
    expect(classify('oracle-linux-01', 'Oracle Linux 8 (64-bit)')).toBe('general')
  })

  it('still recognises a real database appliance from its OS', () => {
    expect(classify('appliance1', 'Oracle Database Appliance')).toBe('database')
  })
})

describe('VDI classification', () => {
  it.each(['vdi-01', 'ctx-vda-01', 'citrix01', 'rds01', 'rdsh-02', 'avd-host-1', 'sessionhost01'])('%s is VDI', (name) => {
    expect(classify(name, WINDOWS)).toBe('vdi')
  })

  it.each(['cards1', 'obsession1', 'boards01'])('%s is not VDI', (name) => {
    expect(classify(name, WINDOWS)).toBe('general')
  })
})

describe('infrastructure classification', () => {
  it.each(['DC01', 'dc1', 'corp-dc01', 'addc01', 'dns01', 'dhcp-02', 'ntp1', 'print01', 'printsrv-02', 'jump01', 'bastion-a', 'wsus01', 'ad01'])('%s is infrastructure', (name) => {
    expect(classify(name, WINDOWS)).toBe('infrastructure')
  })

  it.each(['DC1-WEB01', 'mintprod01', 'blueprint-api', 'fingerprint1', 'dc1-app-02'])('%s is not infrastructure', (name) => {
    expect(classify(name, WINDOWS)).toBe('general')
  })
})
