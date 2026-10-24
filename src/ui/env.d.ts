import type { GlimpseApi } from "../shared/types"

declare global {
  interface Window {
    glimpse: GlimpseApi
  }
}
