import { getContext, setContext } from 'svelte';

const SIDEBAR_CTX = Symbol('sidebar');
const MOBILE_BREAKPOINT = 768;

export type SidebarState = {
  open: boolean;
  openMobile: boolean;
  isMobile: boolean;
  toggle: () => void;
  setOpen: (v: boolean) => void;
  setOpenMobile: (v: boolean) => void;
};

export function createSidebarState(defaultOpen = true): SidebarState {
  let open = $state(defaultOpen);
  let openMobile = $state(false);
  let isMobile = $state(false);

  if (typeof window !== 'undefined') {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    isMobile = mql.matches;
    mql.addEventListener('change', (e) => (isMobile = e.matches));
  }

  const ctx: SidebarState = {
    get open() {
      return open;
    },
    get openMobile() {
      return openMobile;
    },
    get isMobile() {
      return isMobile;
    },
    toggle() {
      if (isMobile) openMobile = !openMobile;
      else open = !open;
    },
    setOpen(v) {
      open = v;
    },
    setOpenMobile(v) {
      openMobile = v;
    }
  };
  setContext(SIDEBAR_CTX, ctx);
  return ctx;
}

export function useSidebar(): SidebarState {
  const ctx = getContext<SidebarState>(SIDEBAR_CTX);
  if (!ctx) throw new Error('useSidebar must be used within <Sidebar.Provider>');
  return ctx;
}

export const SIDEBAR_WIDTH = '16rem';
export const SIDEBAR_WIDTH_MOBILE = '18rem';
