import { redirect } from 'next/navigation'

// The middleware handles locale detection and redirects /en or /zh-HK.
// This fallback catches any edge case where / is hit directly.
export default function RootPage() {
  redirect('/en')
}
