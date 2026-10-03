export function useRouter() {
  return { push: (path: string) => { document.documentElement.dataset.navigation = path } }
}
