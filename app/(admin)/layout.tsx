import { AdminHeader } from "./_components/AdminHeader";
import { AdminSidebar } from "./_components/AdminSidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <AdminHeader />
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-8 py-8">
        <AdminSidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
