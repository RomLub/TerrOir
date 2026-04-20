import { NavbarPublic } from "@/components/ui/navbar-public";
import { Footer } from "@/components/ui/footer";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <NavbarPublic />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
