import DashboardPage from '@/features/dashboard/DashboardPage';

type DashboardRouteProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: DashboardRouteProps) {
    const resolvedSearchParams = searchParams ? await searchParams : {};
    const openFromQuery = resolvedSearchParams.newMapping === '1';

    return <DashboardPage initialNewMappingOpen={openFromQuery} />;
}
