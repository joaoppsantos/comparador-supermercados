import { NextResponse } from 'next/server'
import { addCabazEntryForProduct } from '@comparador/core'
import { prisma } from '@/lib/db'

const UNITS = new Set(['kg', 'l', 'un'])

export async function POST(req: Request) {
  const form = await req.formData()
  const action = String(form.get('action') ?? 'add')

  if (action === 'add-product') {
    const productId = Number(form.get('productId'))
    if (Number.isInteger(productId) && productId > 0) {
      await addCabazEntryForProduct(prisma, productId)
    }
    return NextResponse.redirect(new URL('/cabaz', req.url), 303)
  }

  if (action === 'choose' || action === 'unchoose') {
    const entryId = Number(form.get('entryId'))
    const storeId = Number(form.get('storeId'))
    if (Number.isInteger(entryId) && Number.isInteger(storeId)) {
      if (action === 'choose') {
        const productId = Number(form.get('productId'))
        if (Number.isInteger(productId) && productId > 0) {
          await prisma.cabazEntryChoice.upsert({
            where: { entryId_storeId: { entryId, storeId } },
            create: { entryId, storeId, productId },
            update: { productId },
          })
        }
      } else {
        await prisma.cabazEntryChoice.deleteMany({ where: { entryId, storeId } })
      }
    }
    return NextResponse.redirect(new URL('/cabaz', req.url), 303)
  }

  if (action === 'remove') {
    const id = Number(form.get('id'))
    if (Number.isInteger(id)) {
      await prisma.cabazEntry.deleteMany({ where: { id } })
    }
    return NextResponse.redirect(new URL('/cabaz', req.url), 303)
  }

  const label = String(form.get('label') ?? '').trim()
  const tokens = String(form.get('tokens') ?? '')
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  const qtyValue = Number.parseFloat(String(form.get('qtyValue') ?? '').replace(',', '.'))
  const qtyUnit = String(form.get('qtyUnit') ?? '')
  const hasQty = Number.isFinite(qtyValue) && qtyValue > 0 && UNITS.has(qtyUnit)

  if (label && tokens.length > 0) {
    const last = await prisma.cabazEntry.aggregate({ _max: { position: true } })
    await prisma.cabazEntry.create({
      data: {
        label,
        tokens,
        targetQtyValue: hasQty ? qtyValue : null,
        targetQtyUnit: hasQty ? qtyUnit : null,
        position: (last._max.position ?? 0) + 1,
      },
    })
  }
  return NextResponse.redirect(new URL('/cabaz', req.url), 303)
}
