import { lazy, Suspense, useEffect } from 'react';
import { useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { PageHeader, Skeleton, Tabs } from '../components/ui/pbx';
import styles from './AnalysisPage.module.css';

// Each tab loads the first time it is opened (Agency pulls in recharts).
const FailedOrdersAnalysis = lazy(() => import('./analysis/FailedOrdersAnalysis').then((m) => ({ default: m.FailedOrdersAnalysis })));
const PinCodesAnalysis = lazy(() => import('./analysis/PinCodesAnalysis').then((m) => ({ default: m.PinCodesAnalysis })));
const StuckOrdersAnalysis = lazy(() => import('./analysis/StuckOrdersAnalysis').then((m) => ({ default: m.StuckOrdersAnalysis })));
const TicketsAnalysis = lazy(() => import('./analysis/TicketsAnalysis').then((m) => ({ default: m.TicketsAnalysis })));
const CreateTicketForm = lazy(() => import('./analysis/CreateTicketForm').then((m) => ({ default: m.CreateTicketForm })));
const ClaudeAnalysis = lazy(() => import('./analysis/ClaudeAnalysis').then((m) => ({ default: m.ClaudeAnalysis })));
const Reels = lazy(() => import('./analysis/Reels').then((m) => ({ default: m.Reels })));
const Agency = lazy(() => import('./analysis/Agency').then((m) => ({ default: m.Agency })));

const SECTIONS = [
    { id: 'claude', label: 'Claude analysis', href: '/admin/analysis/claude' },
    { id: 'failed-orders', label: 'Failed orders', href: '/admin/analysis/failed-orders' },
    { id: 'pin-codes', label: 'Pin codes', href: '/admin/analysis/pin-codes' },
    { id: 'stuck-orders', label: 'Stuck orders', href: '/admin/analysis/stuck-orders' },
    { id: 'tickets', label: 'Tickets', href: '/admin/analysis/tickets' },
    { id: 'reels', label: 'Reels', href: '/admin/analysis/reels' },
    { id: 'agency', label: 'Agency', href: '/admin/analysis/agency' },
];

// The admin shell loads the signed-in user and draws the topbar; this page is the sections.
export function AnalysisPage() {
    const navigate = useNavigate();
    const location = useLocation();

    const currentPath = location.pathname;
    const active = SECTIONS.find((s) => currentPath.startsWith(s.href))?.id ?? 'claude';

    useEffect(() => {
        if (currentPath === '/admin/analysis' || currentPath === '/admin/analysis/') {
            navigate('/admin/analysis/failed-orders', { replace: true });
        }
    }, [currentPath, navigate]);

    return (
        <div className={styles.page}>
            <PageHeader title="Analysis" description="Ad reviews, delivery failures, pin codes, stuck orders, tickets, reels and agency results.">
                <Tabs
                    label="Analysis sections"
                    items={SECTIONS}
                    value={active}
                    onChange={(id) => navigate(SECTIONS.find((s) => s.id === id)!.href)}
                />
            </PageHeader>

            <Suspense fallback={<Skeleton lines={6} />}>
                <Routes>
                    {/* The CSV-based Ads Analysis was retired; Claude Analysis replaced it. */}
                    <Route path="ads" element={<Navigate to="/admin/analysis/claude" replace />} />
                    <Route path="claude" element={<ClaudeAnalysis />} />
                    <Route path="failed-orders" element={<FailedOrdersAnalysis />} />
                    <Route path="pin-codes" element={<PinCodesAnalysis />} />
                    <Route path="stuck-orders" element={<StuckOrdersAnalysis />} />
                    <Route path="tickets" element={<TicketsAnalysis />} />
                    <Route path="tickets/new" element={<CreateTicketForm />} />
                    <Route path="reels" element={<Reels />} />
                    <Route path="agency" element={<Agency />} />
                    <Route path="*" element={<Navigate to="claude" replace />} />
                </Routes>
            </Suspense>
        </div>
    );
}
