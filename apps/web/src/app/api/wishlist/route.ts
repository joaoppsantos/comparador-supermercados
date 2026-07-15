import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { WISHLIST_NAME } from '@/lib/wishlist'

export async function POST(req: Request) {
  const form = await req.formData()
  const productId = Number(form.get('productId'))
  const backRaw = String(form.get('back') ?? '/')
  const back = backRaw.startsWith('/') ? backRaw : '/'

  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: 'invalid productId' }, { status: 400 })
  }
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 })

  const list =
    (await prisma.shoppingList.findFirst({ where: { name: WISHLIST_NAME } })) ??
    (await prisma.shoppingList.create({ data: { name: WISHLIST_NAME } }))

  const existing = await prisma.shoppingListItem.findFirst({
    where: { listId: list.id, productId },
  })
  if (existing) {
    await prisma.shoppingListItem.delete({ where: { id: existing.id } })
  } else {
    await prisma.shoppingListItem.create({ data: { listId: list.id, productId } })
  }

  return NextResponse.redirect(new URL(back, req.url), 303)
}
