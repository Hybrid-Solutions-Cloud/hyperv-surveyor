import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { ReportMetric, ReportSection, ReportSelection, ReportTable, SolutionReport } from './reportModel'
import { selectedReportSections } from './reportModel'

const NAVY = '0A2034'
const NAVY_RGB = [10, 32, 52] as const
const BLUE = '186091'
const BLUE_RGB = [24, 96, 145] as const
const CYAN = '41B8C2'
const CYAN_RGB = [65, 184, 194] as const
const MUTED = '586B7C'
const MUTED_RGB = [86, 107, 124] as const
const TEXT = '243746'
const TEXT_RGB = [36, 55, 70] as const
const LINE = 'D7E0E7'
const SOFT_FILL = 'F2F6F9'
const ROW_FILL = 'F7F9FB'

const WORD_PAGE_WIDTH = 12_240
const WORD_PAGE_HEIGHT = 15_840
const WORD_MARGIN = 1_080
const WORD_PORTRAIT_WIDTH = WORD_PAGE_WIDTH - WORD_MARGIN * 2
const WORD_LANDSCAPE_WIDTH = WORD_PAGE_HEIGHT - WORD_MARGIN * 2

type PdfOrientation = 'portrait' | 'landscape'

function safeFilename(value: string) {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return cleaned || 'hyper-v-solution'
}

function pdfText(value: string) {
  return value
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/•/g, '-')
    .replace(/×/g, 'x')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/→/g, '->')
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
    `- Author: ${report.metadata.author || 'Not specified'}`,
    `- Organization: ${report.metadata.organization || 'Not specified'}`,
    `- Revision: ${report.metadata.revision} · ${report.metadata.approvalStatus}`,
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

function isCompactColumn(header: string) {
  return /^(qty|count|nodes?|vCPU|RAM each|disk each|vCPU each|feasible|memory|consumed|provisioned|size each|total|VMs each|VMs|right-size factor|VMs \/ CSV)$/i.test(header)
}

function isExpansiveColumn(header: string) {
  return /(finding|basis|source|guest OS|component|option|description|detail|architecture|VM$)/i.test(header)
}

function proportionalColumnWidths(table: ReportTable, totalWidth: number) {
  const count = Math.max(1, table.headers.length)
  const minimum = Math.max(36, Math.min(totalWidth / count * 0.46, totalWidth > 2_000 ? 980 : 56))
  const weights = table.headers.map((header, columnIndex) => {
    const observedLength = Math.max(
      header.length,
      ...table.rows.slice(0, 100).map((row) => String(row[columnIndex] ?? '').length),
    )
    let weight = Math.sqrt(Math.min(72, Math.max(5, observedLength)))
    if (isCompactColumn(header)) weight *= 0.62
    if (isExpansiveColumn(header)) weight *= 1.55
    return weight
  })
  const remaining = Math.max(0, totalWidth - minimum * count)
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1
  const widths = weights.map((weight) => Math.floor(minimum + remaining * weight / weightTotal))
  widths[widths.length - 1] += Math.round(totalWidth - widths.reduce((sum, width) => sum + width, 0))
  return widths
}

function sectionNeedsLandscape(section: ReportSection) {
  return section.tables.some((table) => table.headers.length >= 6)
}

function wordBorder(color = LINE, size = 2) {
  return { style: BorderStyle.SINGLE, size, color }
}

function wordCell(text: string, width: number, options: { header?: boolean; alternate?: boolean; fontSize?: number } = {}) {
  const { header = false, alternate = false, fontSize = 17 } = options
  const isUrl = /^https?:\/\/\S+$/i.test(text.trim())
  const children = isUrl && !header
    ? [new ExternalHyperlink({
      link: text.trim(),
      children: [new TextRun({ text, style: 'Hyperlink', size: fontSize, color: BLUE })],
    })]
    : [new TextRun({ text, bold: header, size: fontSize, color: header ? 'FFFFFF' : TEXT })]

  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: header
      ? { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' }
      : alternate
        ? { type: ShadingType.CLEAR, fill: ROW_FILL, color: 'auto' }
        : undefined,
    margins: { top: 105, bottom: 105, left: 125, right: 125 },
    children: [new Paragraph({
      spacing: { before: 0, after: 0, line: 230, lineRule: LineRuleType.AUTO },
      children,
    })],
  })
}

function wordTable(table: ReportTable, tableWidth: number) {
  const widths = proportionalColumnWidths(table, tableWidth)
  const fontSize = table.headers.length >= 7 ? 15 : table.headers.length >= 5 ? 16 : 17
  const border = wordBorder()
  const borders = {
    top: border,
    bottom: border,
    left: border,
    right: border,
    insideHorizontal: wordBorder('E6EBEF', 1),
    insideVertical: wordBorder('E6EBEF', 1),
  }
  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders,
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: table.headers.map((header, index) => wordCell(header, widths[index], { header: true, fontSize })),
      }),
      ...table.rows.map((row, rowIndex) => new TableRow({
        cantSplit: true,
        children: table.headers.map((_, columnIndex) => wordCell(String(row[columnIndex] ?? ''), widths[columnIndex], {
          alternate: rowIndex % 2 === 1,
          fontSize,
        })),
      })),
    ],
  })
}

function wordMetricsTable(metrics: ReportMetric[], tableWidth: number) {
  const labelWidth = Math.round(tableWidth * 0.32)
  const valueWidth = tableWidth - labelWidth
  const border = wordBorder('DCE4EA', 1)
  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: [labelWidth, valueWidth],
    layout: TableLayoutType.FIXED,
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: metrics.map((metric, index) => new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: labelWidth, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          shading: { type: ShadingType.CLEAR, fill: index % 2 === 0 ? 'EAF1F5' : SOFT_FILL, color: 'auto' },
          margins: { top: 120, bottom: 120, left: 150, right: 150 },
          children: [new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: metric.label.toUpperCase(), size: 15, bold: true, color: MUTED })],
          })],
        }),
        new TableCell({
          width: { size: valueWidth, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 105, bottom: 105, left: 150, right: 150 },
          children: [
            new Paragraph({
              spacing: { before: 0, after: metric.detail ? 35 : 0 },
              children: [new TextRun({ text: metric.value, size: 20, bold: true, color: NAVY })],
            }),
            ...(metric.detail ? [new Paragraph({
              spacing: { before: 0, after: 0, line: 230, lineRule: LineRuleType.AUTO },
              children: [new TextRun({ text: metric.detail, size: 15, italics: true, color: MUTED })],
            })] : []),
          ],
        }),
      ],
    })),
  })
}

function sectionToWord(section: ReportSection, tableWidth: number) {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      text: section.title,
      heading: HeadingLevel.HEADING_1,
      border: { bottom: { style: BorderStyle.SINGLE, size: 9, color: CYAN, space: 8 } },
    }),
  ]
  section.paragraphs.forEach((paragraph) => children.push(new Paragraph({ text: paragraph, keepLines: true })))
  if (section.metrics.length) {
    children.push(wordMetricsTable(section.metrics, tableWidth), new Paragraph({ spacing: { after: 60 } }))
  }
  section.bullets.forEach((bullet) => children.push(new Paragraph({
    text: bullet,
    numbering: { reference: 'report-bullets', level: 0 },
    keepLines: true,
  })))
  section.tables.forEach((table) => {
    if (table.title) children.push(new Paragraph({ text: table.title, heading: HeadingLevel.HEADING_2 }))
    children.push(wordTable(table, tableWidth), new Paragraph({ spacing: { after: 80 } }))
  })
  return children
}

function wordHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 3 } },
      spacing: { after: 60 },
      children: [new TextRun({ text: 'HYPER-V SURVEYOR  |  SOLUTION REPORT', size: 15, color: MUTED, bold: true })],
    })],
  })
}

function wordFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 3 } },
      spacing: { before: 60 },
      children: [new TextRun({ children: ['Hyper-V Surveyor   |   Page ', PageNumber.CURRENT], size: 15, color: MUTED })],
    })],
  })
}

function wordPageProperties(landscape: boolean, nextPage = false) {
  return {
    ...(nextPage ? { type: SectionType.NEXT_PAGE } : {}),
    page: {
      size: {
        width: WORD_PAGE_WIDTH,
        height: WORD_PAGE_HEIGHT,
        ...(landscape ? { orientation: PageOrientation.LANDSCAPE } : {}),
      },
      margin: {
        top: WORD_MARGIN,
        right: WORD_MARGIN,
        bottom: WORD_MARGIN,
        left: WORD_MARGIN,
        header: 520,
        footer: 520,
      },
    },
  }
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
          run: { font: 'Arial', size: 20, color: TEXT },
          paragraph: { spacing: { before: 0, after: 135, line: 276, lineRule: LineRuleType.AUTO } },
        },
      },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Arial', size: 64, bold: true, color: NAVY },
          paragraph: { spacing: { before: 0, after: 190 }, keepNext: true },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Arial', size: 34, bold: true, color: BLUE },
          paragraph: { spacing: { before: 0, after: 190 }, keepNext: true, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Arial', size: 24, bold: true, color: NAVY },
          paragraph: { spacing: { before: 250, after: 120 }, keepNext: true, outlineLevel: 1 },
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
          style: { paragraph: { indent: { left: 650, hanging: 300 }, spacing: { after: 110, line: 270, lineRule: LineRuleType.AUTO } } },
        }],
      }],
    },
    sections: [
      {
        properties: wordPageProperties(false),
        headers: { default: wordHeader() },
        footers: { default: wordFooter() },
        children: [
          new Paragraph({
            spacing: { before: 1_550, after: 90 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: CYAN, space: 10 } },
            children: [new TextRun({ text: 'CUSTOMER SOLUTION REPORT', size: 18, bold: true, color: BLUE, characterSpacing: 80 })],
          }),
          new Paragraph({ text: report.title, style: 'Title' }),
          new Paragraph({
            spacing: { after: 700 },
            children: [new TextRun({ text: 'Sizing, architecture, storage, and management-plane design', size: 22, color: MUTED })],
          }),
          new Paragraph({ children: [new TextRun({ text: 'PREPARED FOR', size: 15, bold: true, color: MUTED })], spacing: { after: 45 } }),
          new Paragraph({ children: [new TextRun({ text: report.customerName, size: 28, bold: true, color: NAVY })], spacing: { after: 300 } }),
          new Paragraph({ children: [new TextRun({ text: 'SELECTED ARCHITECTURE', size: 15, bold: true, color: MUTED })], spacing: { after: 45 } }),
          new Paragraph({ children: [new TextRun({ text: report.selectedArchitecture, size: 23, bold: true, color: BLUE })], spacing: { after: 300 } }),
          new Paragraph({ children: [new TextRun({ text: 'GENERATED', size: 15, bold: true, color: MUTED })], spacing: { after: 45 } }),
          new Paragraph({ children: [new TextRun({ text: new Date(report.generatedAt).toLocaleString(), size: 19, color: TEXT })], spacing: { after: 250 } }),
          new Paragraph({ children: [new TextRun({ text: `Revision ${report.metadata.revision} · ${report.metadata.approvalStatus.toUpperCase()}${report.metadata.author ? ` · ${report.metadata.author}` : ''}`, size: 17, color: TEXT })], spacing: { after: 160 } }),
          new Paragraph({ children: [new TextRun({ text: `${sections.length} report sections included`, size: 17, italics: true, color: MUTED })] }),
        ],
      },
      ...sections.map((section) => {
        const landscape = sectionNeedsLandscape(section)
        const tableWidth = landscape ? WORD_LANDSCAPE_WIDTH : WORD_PORTRAIT_WIDTH
        return {
          properties: wordPageProperties(landscape, true),
          headers: { default: wordHeader() },
          footers: { default: wordFooter() },
          children: sectionToWord(section, tableWidth),
        }
      }),
    ],
  })
  return Packer.toBlob(documentFile)
}

function pdfPageOrientation(section: ReportSection): PdfOrientation {
  return sectionNeedsLandscape(section) ? 'landscape' : 'portrait'
}

function addPdfPage(doc: jsPDF, orientation: PdfOrientation) {
  doc.addPage('letter', orientation)
}

function drawPdfCover(doc: jsPDF, report: SolutionReport, sections: ReportSection[]) {
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  doc.setFillColor(...NAVY_RGB)
  doc.rect(0, 0, width, 258, 'F')
  doc.setFillColor(...CYAN_RGB)
  doc.rect(0, 0, 10, 258, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(101, 214, 219)
  doc.text('CUSTOMER SOLUTION REPORT', 54, 58)
  doc.setFontSize(29)
  doc.setTextColor(255, 255, 255)
  const titleLines = doc.splitTextToSize(pdfText(report.title), width - 108) as string[]
  doc.text(titleLines, 54, 105)
  const subtitleY = 105 + titleLines.length * 34 + 12
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(207, 226, 237)
  doc.text('Sizing, architecture, storage, and management-plane design', 54, subtitleY)

  const cards = [
    ['Prepared for', report.customerName],
    ['Selected architecture', report.selectedArchitecture],
    ['Revision / status', `${report.metadata.revision} / ${report.metadata.approvalStatus}`],
    ['Prepared by', [report.metadata.author, report.metadata.organization].filter(Boolean).join(' · ') || 'Not specified'],
    ['Generated', new Date(report.generatedAt).toLocaleString()],
  ]
  let y = 310
  for (const [label, value] of cards) {
    doc.setFillColor(246, 249, 251)
    doc.setDrawColor(215, 224, 231)
    doc.roundedRect(54, y, width - 108, 62, 5, 5, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED_RGB)
    doc.text(label.toUpperCase(), 70, y + 20)
    doc.setFontSize(13)
    doc.setTextColor(...NAVY_RGB)
    doc.text(doc.splitTextToSize(pdfText(value), width - 142), 70, y + 43)
    y += 76
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...BLUE_RGB)
  doc.text('REPORT SCOPE', 54, y + 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...TEXT_RGB)
  const names = sections.map((section) => section.title)
  const midpoint = Math.ceil(names.length / 2)
  names.forEach((name, index) => {
    const column = index >= midpoint ? 1 : 0
    const row = column ? index - midpoint : index
    doc.setFillColor(...CYAN_RGB)
    doc.circle(58 + column * 255, y + 34 + row * 18, 1.8, 'F')
    doc.text(pdfText(name), 66 + column * 255, y + 37 + row * 18)
  })
  doc.setFontSize(8)
  doc.setTextColor(...MUTED_RGB)
  doc.text(`${sections.length} selected sections`, 54, height - 54)
}

function drawPdfMetricCards(doc: jsPDF, metrics: ReportMetric[], y: number, ensureSpace: (height: number) => void) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const columns = pageWidth > 700 ? 3 : 2
  const gap = 9
  const contentWidth = pageWidth - 108
  const cardWidth = (contentWidth - gap * (columns - 1)) / columns

  for (let start = 0; start < metrics.length; start += columns) {
    const row = metrics.slice(start, start + columns)
    const layouts = row.map((metric) => {
      doc.setFontSize(12)
      const valueLines = doc.splitTextToSize(pdfText(metric.value), cardWidth - 24) as string[]
      doc.setFontSize(7.5)
      const detailLines = metric.detail ? doc.splitTextToSize(pdfText(metric.detail), cardWidth - 24) as string[] : []
      const height = Math.max(61, 31 + valueLines.length * 13 + detailLines.length * 9)
      return { metric, valueLines, detailLines, height }
    })
    const rowHeight = Math.max(...layouts.map((layout) => layout.height))
    ensureSpace(rowHeight + 9)

    layouts.forEach((layout, column) => {
      const x = 54 + column * (cardWidth + gap)
      doc.setFillColor(246, 249, 251)
      doc.setDrawColor(215, 224, 231)
      doc.roundedRect(x, y, cardWidth, rowHeight, 4, 4, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.2)
      doc.setTextColor(...MUTED_RGB)
      doc.text(pdfText(layout.metric.label).toUpperCase(), x + 12, y + 17)
      doc.setFontSize(12)
      doc.setTextColor(...NAVY_RGB)
      doc.text(layout.valueLines, x + 12, y + 35)
      if (layout.detailLines.length) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(...MUTED_RGB)
        doc.text(layout.detailLines, x + 12, y + 38 + layout.valueLines.length * 13)
      }
    })
    y += rowHeight + 9
  }
  return y
}

function pdfSection(doc: jsPDF, section: ReportSection) {
  const orientation = pdfPageOrientation(section)
  addPdfPage(doc, orientation)
  let y = 68

  const startContinuationPage = () => {
    addPdfPage(doc, orientation)
    y = 62
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...BLUE_RGB)
    doc.text(`${pdfText(section.title).toUpperCase()}  /  CONTINUED`, 54, y)
    y += 24
  }

  const ensureSpace = (height: number) => {
    const pageHeight = doc.internal.pageSize.getHeight()
    if (y + height > pageHeight - 52) startContinuationPage()
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...CYAN_RGB)
  doc.text('SOLUTION REPORT', 54, y)
  y += 25
  doc.setFontSize(20)
  doc.setTextColor(...NAVY_RGB)
  doc.text(pdfText(section.title), 54, y)
  y += 12
  doc.setDrawColor(...CYAN_RGB)
  doc.setLineWidth(2)
  doc.line(54, y, doc.internal.pageSize.getWidth() - 54, y)
  y += 22

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...TEXT_RGB)
  for (const paragraph of section.paragraphs) {
    const lines = doc.splitTextToSize(pdfText(paragraph), doc.internal.pageSize.getWidth() - 108) as string[]
    ensureSpace(lines.length * 14 + 10)
    doc.text(lines, 54, y)
    y += lines.length * 14 + 8
  }

  if (section.metrics.length) {
    y += 2
    y = drawPdfMetricCards(doc, section.metrics, y, ensureSpace)
    y += 3
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...TEXT_RGB)
  for (const bullet of section.bullets) {
    const lines = doc.splitTextToSize(pdfText(bullet), doc.internal.pageSize.getWidth() - 130) as string[]
    ensureSpace(lines.length * 12 + 7)
    doc.setFillColor(...CYAN_RGB)
    doc.circle(59, y - 2.6, 1.8, 'F')
    doc.text(lines, 69, y)
    y += lines.length * 12 + 5
  }

  for (const table of section.tables) {
    if (table.title) {
      ensureSpace(32)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...NAVY_RGB)
      doc.text(pdfText(table.title), 54, y + 7)
      y += 20
    }
    ensureSpace(55)
    const contentWidth = doc.internal.pageSize.getWidth() - 108
    const widths = proportionalColumnWidths(table, contentWidth)
    const columnStyles = Object.fromEntries(table.headers.map((header, index) => [index, {
      cellWidth: widths[index],
      halign: isCompactColumn(header) ? 'right' as const : 'left' as const,
    }]))
    autoTable(doc, {
      startY: y,
      head: [table.headers.map(pdfText)],
      body: table.rows.map((row) => table.headers.map((_, index) => pdfText(String(row[index] ?? '')))),
      margin: { left: 54, right: 54, top: 50, bottom: 44 },
      tableWidth: contentWidth,
      styles: {
        font: 'helvetica',
        fontSize: table.headers.length >= 7 ? 7.1 : table.headers.length >= 5 ? 7.8 : 8.3,
        cellPadding: 4,
        overflow: 'linebreak',
        textColor: [...TEXT_RGB],
        lineColor: [221, 228, 233],
        lineWidth: 0.35,
        valign: 'middle',
      },
      headStyles: { fillColor: [...NAVY_RGB], textColor: 255, fontStyle: 'bold', lineColor: [...NAVY_RGB] },
      alternateRowStyles: { fillColor: [247, 249, 251] },
      columnStyles,
      rowPageBreak: 'avoid',
      showHead: 'everyPage',
    })
    y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 18
  }
}

export function reportToPdfBlob(report: SolutionReport, selection: ReportSelection) {
  const sections = selectedReportSections(report, selection)
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true })
  doc.setProperties({
    title: report.title,
    subject: `Solution sizing and management-plane report for ${report.customerName}`,
    author: 'Hyper-V Surveyor',
    creator: 'Hyper-V Surveyor',
  })
  drawPdfCover(doc, report, sections)
  sections.forEach((section) => pdfSection(doc, section))

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    const width = doc.internal.pageSize.getWidth()
    const height = doc.internal.pageSize.getHeight()
    if (page > 1) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED_RGB)
      doc.text('HYPER-V SURVEYOR', 54, 24)
      doc.setFont('helvetica', 'normal')
      doc.text(pdfText(report.customerName), width - 54, 24, { align: 'right' })
      doc.setDrawColor(215, 224, 231)
      doc.setLineWidth(0.6)
      doc.line(54, 34, width - 54, 34)
    }
    doc.setDrawColor(215, 224, 231)
    doc.setLineWidth(0.6)
    doc.line(54, height - 34, width - 54, height - 34)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED_RGB)
    doc.text('Hyper-V Surveyor  |  Planning report', 54, height - 20)
    doc.text(`Page ${page} of ${pages}`, width - 54, height - 20, { align: 'right' })
  }
  return doc.output('blob')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlText(value: string) {
  return escapeHtml(value).replace(/\n/g, '<br>')
}

function htmlCell(value: string) {
  const trimmed = value.trim()
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return `<a href="${escapeHtml(trimmed)}" target="_blank" rel="noreferrer">${htmlText(value)}</a>`
  }
  return htmlText(value)
}

function htmlTable(table: ReportTable) {
  return `
    <div class="table-block">
      ${table.title ? `<h3>${htmlText(table.title)}</h3>` : ''}
      <div class="table-scroll">
        <table>
          <thead><tr>${table.headers.map((header) => `<th>${htmlText(header)}</th>`).join('')}</tr></thead>
          <tbody>${table.rows.map((row) => `<tr>${table.headers.map((_, index) => `<td>${htmlCell(String(row[index] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
      ${table.rows.length === 0 ? '<p class="empty-table">No rows are available for this section.</p>' : ''}
    </div>`
}

function htmlSection(section: ReportSection) {
  return `
    <section class="report-section" id="section-${section.id}">
      <div class="section-kicker">Solution report</div>
      <h2>${htmlText(section.title)}</h2>
      ${section.paragraphs.map((paragraph) => `<p>${htmlText(paragraph)}</p>`).join('')}
      ${section.metrics.length ? `<div class="metrics">${section.metrics.map((metric) => `
        <article>
          <span>${htmlText(metric.label)}</span>
          <strong>${htmlText(metric.value)}</strong>
          ${metric.detail ? `<small>${htmlText(metric.detail)}</small>` : ''}
        </article>`).join('')}</div>` : ''}
      ${section.bullets.length ? `<ul>${section.bullets.map((bullet) => `<li>${htmlText(bullet)}</li>`).join('')}</ul>` : ''}
      ${section.tables.map(htmlTable).join('')}
    </section>`
}

export function reportToHtml(report: SolutionReport, selection: ReportSelection) {
  const sections = selectedReportSections(report, selection)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(report.title)}</title>
  <style>
    :root { --navy:#0a2034; --blue:#186091; --cyan:#41b8c2; --text:#243746; --muted:#586b7c; --line:#d7e0e7; --soft:#f4f7f9; }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; color:var(--text); background:#e9eef2; font:14px/1.55 Arial, Helvetica, sans-serif; }
    button, a { font:inherit; }
    a { color:var(--blue); overflow-wrap:anywhere; }
    .toolbar { position:sticky; z-index:10; top:0; display:flex; justify-content:space-between; align-items:center; gap:18px; padding:10px 22px; color:#d9e8f1; background:rgba(10,32,52,.97); box-shadow:0 2px 12px rgba(10,32,52,.18); }
    .toolbar strong { color:#fff; font-size:13px; }
    .toolbar span { color:#a9c0d0; font-size:11px; }
    .toolbar button { padding:8px 13px; color:#fff; background:var(--blue); border:1px solid #4f8db6; border-radius:6px; cursor:pointer; font-weight:700; }
    .shell { display:grid; grid-template-columns:250px minmax(0, 1020px); gap:22px; justify-content:center; align-items:start; padding:24px; }
    aside { position:sticky; top:76px; padding:18px; color:#dce9f1; background:var(--navy); border-radius:10px; box-shadow:0 9px 30px rgba(10,32,52,.18); }
    aside .brand { color:#67d5da; font-size:10px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; }
    aside h2 { margin:8px 0 17px; color:#fff; font-size:18px; }
    aside nav { display:grid; gap:5px; }
    aside a { padding:8px 9px; color:#c8dbe7; border-radius:5px; text-decoration:none; font-size:12px; }
    aside a:hover { color:#fff; background:#153b58; }
    main { display:grid; gap:18px; min-width:0; }
    .cover { min-height:340px; padding:46px 48px; color:#fff; background:linear-gradient(125deg, var(--navy), #123f60); border-radius:12px; box-shadow:0 10px 32px rgba(10,32,52,.18); }
    .cover .eyebrow, .section-kicker { color:#65d6db; font-size:10px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; }
    .cover h1 { max-width:760px; margin:18px 0 12px; color:#fff; font-size:42px; line-height:1.08; letter-spacing:-.025em; }
    .cover .subtitle { color:#d4e4ed; font-size:16px; }
    .cover-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-top:58px; }
    .cover-grid div { padding:13px 14px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.13); border-radius:7px; }
    .cover-grid span, .cover-grid strong { display:block; }
    .cover-grid span { color:#9fc1d4; font-size:9px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
    .cover-grid strong { margin-top:5px; color:#fff; font-size:13px; }
    .report-section { min-width:0; padding:30px 32px; background:#fff; border:1px solid var(--line); border-radius:10px; box-shadow:0 5px 20px rgba(10,32,52,.07); }
    .report-section > h2 { margin:7px 0 18px; padding-bottom:12px; color:var(--navy); border-bottom:3px solid var(--cyan); font-size:25px; line-height:1.2; }
    .report-section > p { max-width:900px; color:#506375; }
    .metrics { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px,1fr)); gap:9px; margin:20px 0; }
    .metrics article { padding:14px 15px; background:#f5f8fa; border:1px solid var(--line); border-radius:8px; }
    .metrics span, .metrics strong, .metrics small { display:block; }
    .metrics span { color:var(--muted); font-size:10px; font-weight:800; letter-spacing:.035em; text-transform:uppercase; }
    .metrics strong { margin:6px 0 4px; color:var(--navy); font-size:19px; line-height:1.2; }
    .metrics small { color:var(--muted); font-size:11px; }
    ul { padding-left:22px; color:#506375; }
    li + li { margin-top:7px; }
    li::marker { color:var(--cyan); }
    .table-block { margin-top:24px; }
    .table-block h3 { margin:0 0 9px; color:var(--navy); font-size:16px; }
    .table-scroll { max-width:100%; overflow:auto; border:1px solid var(--line); border-radius:8px; }
    table { width:100%; min-width:680px; border-collapse:collapse; background:#fff; font-size:11px; }
    th, td { padding:9px 10px; border-right:1px solid #e4eaee; border-bottom:1px solid #e4eaee; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
    th:last-child, td:last-child { border-right:0; }
    tr:last-child td { border-bottom:0; }
    th { position:sticky; top:0; color:#fff; background:var(--navy); font-size:10px; letter-spacing:.025em; }
    tbody tr:nth-child(even) { background:#f7f9fb; }
    .empty-table { color:var(--muted); font-size:12px; }
    .back-top { display:inline-block; margin-top:20px; color:var(--muted); font-size:11px; }
    @media (max-width:900px) {
      .shell { grid-template-columns:1fr; padding:14px; }
      aside { position:static; }
      aside nav { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .cover { padding:35px 28px; }
      .cover h1 { font-size:34px; }
      .cover-grid { grid-template-columns:1fr; margin-top:38px; }
    }
    @media (max-width:560px) {
      .toolbar span { display:none; }
      aside nav { grid-template-columns:1fr; }
      .report-section { padding:23px 20px; }
      .cover h1 { font-size:29px; }
    }
    @media print {
      @page { size:letter; margin:.55in; }
      body { background:#fff; font-size:9pt; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
      .toolbar, aside, .back-top { display:none !important; }
      .shell { display:block; padding:0; }
      main { display:block; }
      .cover { min-height:0; margin:0 0 .25in; padding:.45in; border-radius:0; box-shadow:none; break-after:page; }
      .cover h1 { font-size:27pt; }
      .report-section { margin:0; padding:.12in 0; border:0; border-radius:0; box-shadow:none; break-before:page; }
      .report-section > h2 { font-size:18pt; }
      .metrics { grid-template-columns:repeat(3,1fr); }
      .metrics article { break-inside:avoid; }
      .table-scroll { overflow:visible; border-radius:0; }
      table { min-width:0; font-size:7pt; }
      th { position:static; }
      tr { break-inside:avoid; }
      a { color:var(--text); text-decoration:none; }
    }
  </style>
</head>
<body id="top">
  <div class="toolbar">
    <div><strong>Hyper-V Surveyor solution report</strong><br><span>Self-contained offline report · ${sections.length} sections</span></div>
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="shell">
    <aside>
      <div class="brand">Hyper-V Surveyor</div>
      <h2>Report contents</h2>
      <nav>${sections.map((section) => `<a href="#section-${section.id}">${htmlText(section.title)}</a>`).join('')}</nav>
    </aside>
    <main>
      <header class="cover">
        <div class="eyebrow">Customer solution report</div>
        <h1>${htmlText(report.title)}</h1>
        <div class="subtitle">Sizing, architecture, storage, and management-plane design</div>
        <div class="cover-grid">
          <div><span>Prepared for</span><strong>${htmlText(report.customerName)}</strong></div>
          <div><span>Selected architecture</span><strong>${htmlText(report.selectedArchitecture)}</strong></div>
          <div><span>Revision / status</span><strong>${htmlText(`${report.metadata.revision} / ${report.metadata.approvalStatus}`)}</strong></div>
          <div><span>Prepared by</span><strong>${htmlText([report.metadata.author, report.metadata.organization].filter(Boolean).join(' · ') || 'Not specified')}</strong></div>
          <div><span>Generated</span><strong>${htmlText(new Date(report.generatedAt).toLocaleString())}</strong></div>
        </div>
      </header>
      ${sections.map(htmlSection).join('')}
      <a class="back-top" href="#top">Back to top</a>
    </main>
  </div>
</body>
</html>`
}

export function downloadMarkdownReport(report: SolutionReport, selection: ReportSelection) {
  downloadBlob(new Blob([reportToMarkdown(report, selection)], { type: 'text/markdown;charset=utf-8' }), `${safeFilename(report.customerName)}-solution-report.md`)
}

export function downloadJsonReport(report: SolutionReport, selection: ReportSelection) {
  downloadBlob(new Blob([reportToJson(report, selection)], { type: 'application/json;charset=utf-8' }), `${safeFilename(report.customerName)}-solution-report.json`)
}

export function downloadHtmlReport(report: SolutionReport, selection: ReportSelection) {
  downloadBlob(new Blob([reportToHtml(report, selection)], { type: 'text/html;charset=utf-8' }), `${safeFilename(report.customerName)}-solution-report.html`)
}

export async function downloadWordReport(report: SolutionReport, selection: ReportSelection) {
  downloadBlob(await reportToWordBlob(report, selection), `${safeFilename(report.customerName)}-solution-report.docx`)
}

export function downloadPdfReport(report: SolutionReport, selection: ReportSelection) {
  downloadBlob(reportToPdfBlob(report, selection), `${safeFilename(report.customerName)}-solution-report.pdf`)
}
