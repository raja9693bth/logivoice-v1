import React from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { DemoModeBanner } from '@/components/ui/Banner';
import { SidebarProvider } from '@/components/layout/SidebarContext';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-slate-50 dark:bg-[#090d16] text-slate-900 dark:text-slate-100 max-w-full overflow-x-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 max-w-full overflow-x-hidden">
          <DemoModeBanner />
          <Header />
          <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto overflow-x-hidden min-w-0 max-w-full">
            <div className="max-w-7xl mx-auto space-y-6 min-w-0 max-w-full">{children}</div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
