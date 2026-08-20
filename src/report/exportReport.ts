import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { ReportSection, ReportSelection, ReportTable, SolutionReport } from './reportModel'
import { selectedReportSections } from './reportModel'

const NAVY = '0A2034'
const BLUE = '186091'
const MUTED = '586B7C'
const TABLE_FILL = 'F2F4F7'
const TABLE_WIDTH_DXA = 9360

function safeFilename(value: string) {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return cleaned || 'hyper-v-solution'
}

function pdfText(value: string) {
  return value.replace(/[–—]/g, '-').replace(/•/g, '-')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function markdownCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function markdownTable(table: ReportTable) {
  const header = `| ${table.headers.map(markdownCell).join(' | ')} |`
  const rule = `| ${table.headers.map(() => '---').join(' | ')} |`
  const rows = table.rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`)
  return [table.title ? `### ${table.title}` : '', header, rule, ...rows].filter(Boolean).join('\n')
}

export function reportToMarkdown(report: SolutionReport, selection: ReportSelection) {
  const sections = selectedReportSections(report, selection)
  const output = [
    `# ${report.title}`,
    '',
    `- Customer / scenario: ${report.customerName}`,
    `- Selected architecture: ${report.selectedArchitecture}`,
    `- Generated: ${new Date(report.generatedAt).toLocaleString()}`,
    '',
  ]
  for (const section of sections) {
    output.push(`## ${section.title}`, '')
    section.paragraphs.forEach((paragraph) => output.push(paragraph, ''))
    section.metrics.forEach((metric) => output.push(`- **${metric.label}:** ${metric.value}${metric.detail ? ` — ${metric.detail}` : ''}`))
    if (section.metrics.length) output.push('')
    section.bullets.forEach((bullet) => output.push(`- ${bullet}`))
    if (section.bullets.length) output.push('')
    section.tables.forEach((table) => output.push(markdownTable(table), ''))
  }
  return output.join('\n').trimEnd() + '\n'
}

export function reportToJson(report: SolutionReport, selection: ReportSelection) {
  return JSON.stringify({
    ...report,
    includedSectionIds: Object.entries(selection).filter(([, included]) => included).map(([id]) => id),
    sections: selectedReportSections(report, selection),
  }, null, 2)
}

function columnWidths(table: ReportTable) {
  if (table.headers.length === 2) return [2600, 6760]
  if (table.headers.length === 3) return [1300, 1100, 6960]
  if (table.headers.length === 4) return [3000, 900, 1700, 3760]
  if (table.headers.length === 6) return [1100, 1400, 1300, 1500, 2100, 1960]
  if (table.headers.length === 7) return [2200, 500, 1900, 700, 800, 900, 2360]
  if (table.headers.length === 8) return [1700, 1100, 550, 900, 1000, 1000, 900, 2210]
  const base = Math.floor(TABLE_WIDTH_DXA / table.headers.length)
  return table.headers.map((_, index) => index === table.headers.length - 1
    ? TABLE_WIDTH_DXA - base * (table.headers.length - 1)
    : base)
}

function wordCell(text: string, width: number, isHeader = false) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: TABLE_FILL, color: 'auto' } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
      children: [new TextRun({ text, bold: isHeader, size: isHeader ? 16 : 15, color: isHeader ? NAVY : '243746' })],
    })],
  })
}

function wordTable(table: ReportTable) {
  const widths = columnWidths(table)
  const borders = {
    top: { style: BorderStyle.SINGLE, size: 2, color: 'D7E0E7' },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: 'D7E0E7' },
    left: { style: BorderStyle.SINGLE, size: 2, color: 'D7E0E7' },
    right: { style: BorderStyle.SINGLE, size: 2, color: 'D7E0E7' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E6EBEF' },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E6EBEF' },
  }
  return new Table({
    width: { size: TABLE_WIDTH_DXA, type: WidthType.DXA },
    indent: { size: 120, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders,
    rows: [
      new TableRow({ tableHeader: true, children: table.headers.map((header, index) => wordCell(header, widths[index], true)) }),
      ...table.rows.map((row) => new TableRow({ children: row.map((value, index) => wordCell(value, widths[index])) })),
    ],
  })
}

function sectionToWord(section: ReportSection) {
  const children: Array<Paragraph | Table> = [
    new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }),
  ]
  section.paragraphs.forEach((paragraph) => children.push(new Paragraph({ text: paragraph })))
  section.metrics.forEach((metric) => children.push(new Paragraph({
    children: [
      new TextRun({ text: `${metric.label}: `, bold: true, color: NAVY }),
      new TextRun({ text: metric.value }),
      ...(metric.detail ? [new TextRun({ text: ` — ${metric.detail}`, italics: true, color: MUTED })] : []),
    ],
  })))
  section.bullets.forEach((bullet) => children.push(new Paragraph({ text: bullet, numbering: { reference: 'report-bullets', level: 0 } })))
  section.tables.forEach((table) => {
    if (table.title) children.push(new Paragraph({ text: table.title, heading: HeadingLevel.HEADING_2 }))
    children.push(wordTable(table), new Paragraph({ text: '', spacing: { after: 80 } }))
  })
  return children
}

export async function reportToWordBlob(report: SolutionReport, selection: ReportSelection) {
  const sections = selectedReportSections(report, selection)
  const documentFile = new Document({
    creator: 'Hyper-V Surveyor',
    title: report.title,
    description: `Solution sizing and management-plane report for ${report.customerName}`,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: '243746' },
          paragraph: { spacing: { before: 0, after: 120, line: 264, lineRule: LineRuleType.AUTO } },
        },
      },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Calibri', size: 56, bold: true, color: NAVY },
          paragraph: { spacing: { before: 0, after: 160 }, keepNext: true },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Calibri', size: 32, bold: true, color: BLUE },
          paragraph: { spacing: { before: 320, after: 160 }, keepNext: true, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Calibri', size: 26, bold: true, color: BLUE },
          paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 },
        },
      ],
    },
    numbering: {
      config: [{
        reference: 'report-bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 }, spacing: { after: 160, line: 280, lineRule: LineRuleType.AUTO } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 },
        },
      },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'HYPER-V SURVEYOR  |  SOLUTION REPORT', size: 16, color: MUTED, bold: true })],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ children: ['Page ', PageNumber.CURRENT], size: 16, color: MUTED })],
        })] }),
      },
      children: [
        new Paragraph({ children: [new TextRun({ text: 'CUSTOMER SOLUTION REPORT', size: 18, bold: true, color: BLUE })], spacing: { after: 20 } }),
        new Paragraph({ text: report.title, style: 'Title' }),
        new Paragraph({ children: [
          new TextRun({ text: `${report.customerName}  |  ${report.selectedArchitecture}`, size: 24, color: MUTED }),
        ], spacing: { after: 80 } }),
        new Paragraph({ children: [
          new TextRun({ text: `Generated ${new Date(report.generatedAt).toLocaleString()}`, size: 18, italics: true, color: MUTED }),
        ], spacing: { after: 240 } }),
        ...sections.flatMap(sectionToWord),
      ],
    }],
  })
  return Packer.toBlob(documentFile)
}

function pdfSection(doc: jsPDF, section: ReportSection, startY: number) {
  const pageHeight = doc.internal.pageSize.getHeight()
  let y = startY
  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - 50) {
      doc.addPage()
      y = 54
    }
  }
  ensureSpace(34)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(24, 96, 145)
  doc.text(section.title, 54, y)
  y += 20
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(36, 55, 70)
  for (const paragraph of section.paragraphs) {
    const lines = doc.splitTextToSize(pdfText(paragraph), 504) as string[]
    ensureSpace(lines.length * 12 + 8)
    doc.text(lines, 54, y)
    y += lines.length * 12 + 6
  }
  for (const metric of section.metrics) {
    const line = `${metric.label}: ${metric.value}${metric.detail ? ` - ${metric.detail}` : ''}`
    const lines = doc.splitTextToSize(pdfText(line), 504) as string[]
    ensureSpace(lines.length * 11 + 3)
    doc.setFont('helvetica', 'bold')
    doc.text(lines, 54, y)
    doc.setFont('helvetica', 'normal')
    y += lines.length * 11 + 2
  }
  for (const bullet of section.bullets) {
    const lines = doc.splitTextToSize(`- ${pdfText(bullet)}`, 494) as string[]
    ensureSpace(lines.length * 11 + 3)
    doc.text(lines, 64, y)
    y += lines.length * 11 + 2
  }
  for (const table of section.tables) {
    if (table.title) {
      ensureSpace(24)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(10, 32, 52)
      doc.text(pdfText(table.title), 54, y + 6)
      y += 16
    }
    autoTable(doc, {
      startY: y,
      head: [table.headers.map(pdfText)],
      body: table.rows.map((row) => row.map(pdfText)),
      margin: { left: 54, right: 54, top: 54, bottom: 48 },
      styles: { font: 'helvetica', fontSize: table.headers.length > 6 ? 6.5 : 7.5, cellPadding: 3, overflow: 'linebreak', textColor: [36, 55, 70] },
      headStyles: { fillColor: [10, 32, 52], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 249, 251] },
      rowPageBreak: 'avoid',
      showHead: 'everyPage',
    })
    y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 16
  }
  return y
}

export function reportToPdfBlob(report: SolutionReport, selection: ReportSelection) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true })
  doc.setFillColor(10, 32, 52)
  doc.rect(0, 0, 612, 124, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(84, 205, 211)
  doc.text('CUSTOMER SOLUTION REPORT', 54, 48)
  doc.setFontSize(25)
  doc.setTextColor(255, 255, 255)
  doc.text(doc.splitTextToSize(pdfText(report.title), 504), 54, 78)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(86, 107, 124)
  doc.text(pdfText(`${report.customerName}  |  ${report.selectedArchitecture}  |  ${new Date(report.generatedAt).toLocaleString()}`), 54, 148)

  let y = 178
  selectedReportSections(report, selection).forEach((section) => {
    y = pdfSection(doc, section, y)
  })

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(215, 224, 231)
    doc.line(54, 760, 558, 760)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(86, 107, 124)
    doc.text('Hyper-V Surveyor', 54, 776)
    doc.text(`Page ${page} of ${pages}`, 558, 776, { align: 'right' })
  }
  return doc.output('blob')
}

export function downloadMarkdownReport(report: SolutionReport, selection: ReportSelection) {
  downloadBlob(new Blob([reportToMarkdown(report, selection)], { type: 'text/markdown;charset=utf-8' }), `${safeFilename(report.customerName)}-solution-report.md`)
}

export function downloadJsonReport(report: SolutionReport, selection: ReportSelection) {
  downloadBlob(new Blob([reportToJson(report, selection)], { type: 'application/json;charset=utf-8' }), `${safeFilename(report.customerName)}-solution-report.json`)
}

export async function downloadWordReport(report: SolutionReport, selection: ReportSelection) {
  downloadBlob(await reportToWordBlob(report, selection), `${safeFilename(report.customerName)}-solution-report.docx`)
}

export function downloadPdfReport(report: SolutionReport, selection: ReportSelection) {
  downloadBlob(reportToPdfBlob(report, selection), `${safeFilename(report.customerName)}-solution-report.pdf`)
}
