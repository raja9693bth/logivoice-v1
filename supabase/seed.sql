-- LOGIVOICE V1 — INITIAL SEED DATA
-- Default Tenant: Apex Logistics India (tenant_id: '00000000-0000-0000-0000-000000000001')

-- 1. Tenant
INSERT INTO public.tenants (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Apex Logistics India', 'apex-logistics')
ON CONFLICT (id) DO NOTHING;

-- 2. Client Configuration
INSERT INTO public.client_configs (
    id, tenant_id, business_name, brand_name, primary_operating_cities,
    business_hours, timezone, ai_disclosure_wording, primary_language, secondary_language,
    inbound_phone_number, escalation_contacts, tracking_config, followup_config, sheets_config
) VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Apex Logistics Solutions Pvt Ltd',
    'Apex Logistics',
    ARRAY['Delhi NCR', 'Mumbai', 'Ahmedabad', 'Bengaluru', 'Pune', 'Jaipur'],
    '{"start": "08:00", "end": "22:00", "days": "Mon-Sat"}'::jsonb,
    'Asia/Kolkata',
    'Namaste! Main Apex Logistics ki automated voice assistant hoon.',
    'hi',
    'en',
    '+91-11-4567-8900',
    '[
        {"role": "Primary Dispatcher", "name": "Vikas Sharma", "phone": "+91 98111 22334", "channel": "PHONE", "priority": 1},
        {"role": "Operations Manager", "name": "Rohan Verma", "phone": "+91 98222 33445", "channel": "PHONE", "priority": 2},
        {"role": "Urgent Support Escalation", "name": "Control Tower Desk", "phone": "+91 98333 44556", "channel": "PHONE", "priority": 3}
    ]'::jsonb,
    '{"provider": "MOCK_TMS", "identifier_type": "LR_NUMBER"}'::jsonb,
    '{"enabled": true, "default_channel": "WHATSAPP", "suppress_opt_outs": true}'::jsonb,
    '{"sync_enabled": false, "spreadsheet_id": ""}'::jsonb
) ON CONFLICT (tenant_id) DO NOTHING;

-- 3. Rate Cards
INSERT INTO public.rate_cards (
    id, tenant_id, origin, destination, vehicle_type, weight_min_tons, weight_max_tons,
    price_inr, minimum_charge_inr, effective_from, status, transit_time_hours, source_version
) VALUES
('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Delhi', 'Mumbai', '32ft MXL', 14, 18, 54000, 48000, '2026-01-01', 'ACTIVE', 48, 'v1.0'),
('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Delhi', 'Ahmedabad', '19ft Open', 5, 9, 28500, 25000, '2026-01-01', 'ACTIVE', 36, 'v1.0'),
('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Mumbai', 'Bengaluru', '24ft Container', 8, 12, 42000, 38000, '2026-01-01', 'ACTIVE', 32, 'v1.0'),
('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'Pune', 'Hyderabad', 'Tata Ace', 0.8, 1.5, 9500, 8500, '2026-01-01', 'ACTIVE', 18, 'v1.0'),
('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', 'Delhi', 'Jaipur', '14ft Closed', 2.5, 4.0, 11500, 10000, '2026-01-01', 'ACTIVE', 8, 'v1.0')
ON CONFLICT (id) DO NOTHING;

-- 4. Tracking Records
INSERT INTO public.tracking_records (
    id, tenant_id, tracking_reference, status, current_location, status_timestamp, eta_if_verified, source
) VALUES
('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'LR-99214', 'IN_TRANSIT', 'Surat Toll Plaza (NH 48)', NOW() - INTERVAL '45 minutes', NOW() + INTERVAL '14 hours', 'MOCK_TMS'),
('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'LR-88102', 'OUT_FOR_DELIVERY', 'Bhiwandi Hub, Mumbai', NOW() - INTERVAL '2 hours', NOW() + INTERVAL '3 hours', 'MOCK_TMS'),
('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'LR-77409', 'DELIVERED', 'Peenya Industrial Area, Bengaluru', NOW() - INTERVAL '1 day', NULL, 'MOCK_TMS')
ON CONFLICT (id) DO NOTHING;

-- 5. Knowledge Items
INSERT INTO public.knowledge_items (
    id, tenant_id, category, title, content, status, version
) VALUES
('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', 'SERVICE_AREA', 'Active Service Corridors', 'Apex Logistics provides primary full-truckload (FTL) and scheduled part-truckload (PTL) services across Northern, Western, and Southern freight corridors including Delhi NCR, Mumbai, Ahmedabad, Bengaluru, Pune, and Jaipur. Remote hilly regions are subject to weather verification.', 'APPROVED', 'v1.0'),
('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', 'RATE_POLICY', 'Standard Commercial Pricing Rules', 'Rates are calculated based on origin, destination, vehicle type, and declared cargo weight. Quoted rates on phone are classified as ESTIMATE unless confirmed by operations. Standard toll taxes are included; loading/unloading detention charges apply after 4 hours free time (₹1,500/day).', 'APPROVED', 'v1.0'),
('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000001', 'BOOKING_RULES', 'Advance Booking & Vehicle Placement', 'Booking requests must specify pickup date, origin warehouse, delivery address, material type, and approximate weight. Same-day vehicle placement requires confirmation before 12:00 PM IST. Hazardous materials require advance MSDS approval.', 'APPROVED', 'v1.0'),
('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000001', 'ESCALATION_RULES', 'Human Transfer & Complaint Protocol', 'If caller explicitly requests a human manager, or reports cargo damage, severe delay exceeding 24 hours, or demands commercial discounts outside approved matrices, immediate transfer to the Primary Dispatcher (+91 98111 22334) is required. If line is busy, create an urgent callback request.', 'APPROVED', 'v1.0')
ON CONFLICT (id) DO NOTHING;
