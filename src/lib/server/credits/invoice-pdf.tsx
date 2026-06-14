import "server-only";

import * as React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { InvoiceDoc } from "./types";

/**
 * §14-UStG-Rechnung als deklaratives @react-pdf-Template (pure Node, kein
 * Chromium-Binary). Wird EAGER zum Ausstellungszeitpunkt gerendert und im Blob
 * eingefroren (GoBD-Unveraenderbarkeit). Bei Reverse-Charge: 0 % USt + sichtbarer
 * Pflichthinweis. USt-IdNr des Kunden wird verlaesslich ausgewiesen.
 */

/**
 * Template-Version, am InvoiceDoc eingefroren. Aendert sich das Layout (Logo,
 * Fusszeile, Geschaeftsfuehrung), wird "v2" eingefuehrt; Altrechnungen rendern
 * weiterhin ihre eingefrorene Version -> kein visueller GoBD-Drift beim
 * (seltenen) Lazy-Fallback Monate spaeter.
 */
export const INVOICE_TEMPLATE_VERSION = "v1";

function eur(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency.toUpperCase() }).format(
    (cents ?? 0) / 100
  );
}

function dateDe(iso: string): string {
  // Kein Date.now(); nur das eingefrorene ISO formatieren.
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = d.getUTCFullYear();
  return `${dd}.${mm}.${yy}`;
}

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.4 },
  row: { flexDirection: "row" },
  spaceBetween: { flexDirection: "row", justifyContent: "space-between" },
  supplierName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  muted: { color: "#555" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 24 },
  sectionLabel: { fontSize: 8, color: "#888", textTransform: "uppercase", marginBottom: 2 },
  block: { marginTop: 16 },
  metaRight: { textAlign: "right" },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    paddingBottom: 4,
    marginTop: 24,
    fontFamily: "Helvetica-Bold",
  },
  tableRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  colDesc: { width: "55%" },
  colNum: { width: "15%", textAlign: "right" },
  totals: { marginTop: 16, alignSelf: "flex-end", width: "45%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grandTotal: { fontFamily: "Helvetica-Bold", borderTopWidth: 1, borderTopColor: "#333", marginTop: 4, paddingTop: 4 },
  note: { marginTop: 20, padding: 8, backgroundColor: "#f4f4f5", fontSize: 9 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#888", borderTopWidth: 0.5, borderTopColor: "#ddd", paddingTop: 6 },
});

function InvoiceDocument({ inv }: { inv: InvoiceDoc }): React.ReactElement {
  const sup = inv.supplier;
  const b = inv.billing;
  const isReverseCharge = inv.taxTreatment === "reverse_charge";
  return (
    <Document title={inv.invoiceNumber}>
      <Page size="A4" style={s.page}>
        {/* Aussteller */}
        <View style={s.spaceBetween}>
          <View>
            <Text style={s.supplierName}>{sup.companyName}</Text>
            <Text style={s.muted}>{sup.addressLine1}</Text>
            <Text style={s.muted}>
              {sup.postalCode} {sup.city}
            </Text>
            {sup.email ? <Text style={s.muted}>{sup.email}</Text> : null}
          </View>
          <View style={s.metaRight}>
            {sup.vatId ? <Text style={s.muted}>USt-IdNr: {sup.vatId}</Text> : null}
            {sup.taxNumber ? <Text style={s.muted}>Steuernr: {sup.taxNumber}</Text> : null}
          </View>
        </View>

        {/* Empfaenger */}
        <View style={s.block}>
          <Text style={s.sectionLabel}>Rechnung an</Text>
          <Text>{b.companyName}</Text>
          <Text>{b.addressLine1}</Text>
          {b.addressLine2 ? <Text>{b.addressLine2}</Text> : null}
          <Text>
            {b.postalCode} {b.city}
          </Text>
          <Text>{b.country}</Text>
          {b.vatId ? <Text style={{ marginTop: 4 }}>USt-IdNr: {b.vatId}</Text> : null}
        </View>

        {/* Titel + Meta */}
        <Text style={s.title}>Rechnung</Text>
        <View style={[s.spaceBetween, { marginTop: 8 }]}>
          <View>
            <Text style={s.sectionLabel}>Rechnungsnummer</Text>
            <Text>{inv.invoiceNumber}</Text>
          </View>
          <View>
            <Text style={s.sectionLabel}>Rechnungsdatum</Text>
            <Text>{dateDe(inv.issuedAt)}</Text>
          </View>
          <View>
            <Text style={s.sectionLabel}>Leistungsdatum</Text>
            <Text>{dateDe(inv.issuedAt)}</Text>
          </View>
        </View>

        {/* Positionen */}
        <View style={s.tableHeader}>
          <Text style={s.colDesc}>Beschreibung</Text>
          <Text style={s.colNum}>Netto</Text>
          <Text style={s.colNum}>USt</Text>
          <Text style={s.colNum}>Betrag</Text>
        </View>
        <View style={s.tableRow}>
          <Text style={s.colDesc}>{inv.lineItemDescription}</Text>
          <Text style={s.colNum}>{eur(inv.netCents, inv.currency)}</Text>
          <Text style={s.colNum}>{isReverseCharge ? "0 %" : `${Math.round(inv.taxRate * 100)} %`}</Text>
          <Text style={s.colNum}>{eur(inv.netCents, inv.currency)}</Text>
        </View>

        {/* Summen */}
        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text>Nettobetrag</Text>
            <Text>{eur(inv.netCents, inv.currency)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text>
              USt {isReverseCharge ? "(0 %)" : `(${Math.round(inv.taxRate * 100)} %)`}
            </Text>
            <Text>{eur(inv.taxCents, inv.currency)}</Text>
          </View>
          <View style={[s.totalRow, s.grandTotal]}>
            <Text>Gesamtbetrag</Text>
            <Text>{eur(inv.grossCents, inv.currency)}</Text>
          </View>
        </View>

        {/* Pflichthinweis Reverse-Charge */}
        {inv.taxNote ? (
          <View style={s.note}>
            <Text>{inv.taxNote}</Text>
          </View>
        ) : null}

        {/* Fusszeile */}
        <View style={s.footer}>
          <Text>
            {sup.companyName}
            {sup.vatId ? ` · USt-IdNr ${sup.vatId}` : ""}
            {sup.iban ? ` · IBAN ${sup.iban}` : ""}
          </Text>
          <Text>Rechnung gemaess §14 UStG. Erstellt am {dateDe(inv.issuedAt)}.</Text>
        </View>
      </Page>
    </Document>
  );
}

/** Rendert die Rechnung zum eingefrorenen PDF-Buffer (eager, zum Ausstellungsdatum). */
export async function renderInvoicePdf(inv: InvoiceDoc): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument inv={inv} />);
}
