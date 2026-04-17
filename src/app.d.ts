declare global {
  namespace App {
    interface Locals {
      session: {
        id: string;
        userId: string;
        displayName: string;
      } | null;
    }

    interface PageData {
      session: App.Locals['session'];
    }
  }
}

export {};
