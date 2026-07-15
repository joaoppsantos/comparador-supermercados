// Plain form POST (no client JS): the route handler toggles and redirects back.
export function WishlistButton({
  productId,
  wishlisted,
  backTo,
}: {
  productId: number
  wishlisted: boolean
  backTo: string
}) {
  return (
    <form method="post" action="/api/wishlist" className="wishlist">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="back" value={backTo} />
      <button
        className="star"
        aria-pressed={wishlisted}
        title={wishlisted ? 'Remover da wishlist' : 'Adicionar à wishlist'}
      >
        {wishlisted ? '★' : '☆'}
      </button>
    </form>
  )
}
