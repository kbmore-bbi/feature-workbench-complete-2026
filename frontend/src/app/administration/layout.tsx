import AdministrationLayoutShell from '@/features/administration/layout/administration-layout-shell';

export default function AdministrationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdministrationLayoutShell>{children}</AdministrationLayoutShell>;
}
