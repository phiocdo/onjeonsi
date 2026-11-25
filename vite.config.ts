import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
// defineConfig는 vitest/config 것을 쓴다(vite 설정에 test 항목 타입이 더해진 것). vite 빌드 설정은 그대로다.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/onjeonsi/' : '/',
  test: {
    // review/는 로컬 검토용 복사본(.git/info/exclude)이라 테스트로 돌리지 않는다
    exclude: [...configDefaults.exclude, 'review/**'],
  },
}))
