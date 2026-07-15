export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatQuantity(value: number, unit: string): string {
  return `${value.toLocaleString('pt-PT')} ${unit}`
}
