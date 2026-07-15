import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Comparador de Supermercados',
  description: 'Comparação de preços: Continente, Pingo Doce, Auchan',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>
        <header className="site-header">
          <div className="inner">
            <Link href="/" className="brand">
              Comparador
            </Link>
            <nav style={{ display: 'flex', gap: 18 }}>
              <Link href="/compare">Duelo</Link>
              <Link href="/wishlist">Wishlist</Link>
              <Link href="/admin/runs">Runs</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
