-- ═══════════════════════════════════════════════════════════════════════════
-- MarineXchange Africa — Phase 3: Marketplace Product Listing System
--
-- Run AFTER 001_initial_schema.sql.
-- Assumes no existing data in marketplace.products (development environment).
--
-- Changes:
--   0. Defensive re-declaration of shared trigger functions (idempotent)
--   1. marketplace.categories       — hierarchical category tree (17 roots + ~120 leaves)
--   2. marketplace.product_contacts — seller contact info per listing
--   3. marketplace.attributes       — attribute definitions (flexible spec system)
--   4. marketplace.product_attribute_values — dynamic per-product specs
--   5. ALTER marketplace.products   — replace rigid category column, add availability_type
--   6. Seed: all 17 top-level categories + subcategories
--   7. Seed: common global attribute definitions
--   8. Indexes, triggers, RLS updates
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. Ensure shared trigger functions exist ──────────────────────────────────
-- These are also defined in 001_initial_schema.sql. Using CREATE OR REPLACE
-- makes this file safe to run independently or after a schema reset.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'Immutable record: table=%, id=%. This record cannot be modified or deleted.',
        TG_TABLE_NAME,
        COALESCE(OLD.id::TEXT, 'unknown');
END;
$$ LANGUAGE plpgsql;


-- ── 1. Categories (hierarchical) ─────────────────────────────────────────────

CREATE TABLE marketplace.categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL,
    parent_id       UUID REFERENCES marketplace.categories(id) ON DELETE RESTRICT,
    description     TEXT,
    icon            TEXT,           -- emoji or icon identifier for UI
    display_order   INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (slug, parent_id)        -- slug unique within the same parent level
);

-- Global slug uniqueness for root categories (parent_id IS NULL)
CREATE UNIQUE INDEX idx_categories_slug_root
    ON marketplace.categories(slug)
    WHERE parent_id IS NULL;

COMMENT ON TABLE marketplace.categories IS
    'Hierarchical category tree. Top-level categories have parent_id = NULL.';


-- ── 2. Product Contacts ───────────────────────────────────────────────────────

CREATE TABLE marketplace.product_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL UNIQUE REFERENCES marketplace.products(id) ON DELETE CASCADE,
    contact_name    TEXT NOT NULL,
    phone           TEXT NOT NULL,
    email           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marketplace.product_contacts IS
    'Seller contact information for each listing. '
    'Visible to agents and admins; public visibility governed by policy.';

CREATE TRIGGER trg_product_contacts_updated_at
    BEFORE UPDATE ON marketplace.product_contacts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 3. Attribute Definitions ──────────────────────────────────────────────────

CREATE TABLE marketplace.attributes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL,
    data_type       TEXT NOT NULL DEFAULT 'text'
                        CHECK (data_type IN ('text', 'numeric', 'boolean', 'date')),
    unit            TEXT,           -- e.g., "tonnes", "kW", "m", "m²"
    category_id     UUID REFERENCES marketplace.categories(id) ON DELETE SET NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global attributes (category_id IS NULL) must have unique slugs
CREATE UNIQUE INDEX idx_attributes_slug_global
    ON marketplace.attributes(slug)
    WHERE category_id IS NULL;

-- Category-scoped attributes must have unique slugs within their category
CREATE UNIQUE INDEX idx_attributes_slug_category
    ON marketplace.attributes(slug, category_id)
    WHERE category_id IS NOT NULL;

COMMENT ON TABLE marketplace.attributes IS
    'Defines available product specification fields. '
    'category_id = NULL means the attribute applies to all product types.';


-- ── 4. Product Attribute Values ───────────────────────────────────────────────

CREATE TABLE marketplace.product_attribute_values (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES marketplace.products(id) ON DELETE CASCADE,
    attribute_id    UUID NOT NULL REFERENCES marketplace.attributes(id) ON DELETE RESTRICT,
    value_text      TEXT,
    value_numeric   NUMERIC(18, 4),
    value_boolean   BOOLEAN,
    value_date      DATE,
    set_by          UUID NOT NULL REFERENCES public.profiles(id),
    set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_by UUID REFERENCES public.profiles(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (product_id, attribute_id)   -- one value per attribute per product
);

COMMENT ON TABLE marketplace.product_attribute_values IS
    'Dynamic per-product specification values. '
    'Agents and admins can add/edit these during and after verification.';

CREATE TRIGGER trg_product_attribute_values_updated_at
    BEFORE UPDATE ON marketplace.product_attribute_values
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 5. ALTER marketplace.products ────────────────────────────────────────────
-- Replace the rigid category enum with a FK to categories.
-- Add availability_type for the listing model (for_sale / hire / lease / charter).
-- ASSUMPTION: No existing data rows — development environment.

-- Drop the old rigid category column and its CHECK constraint
-- (also drops idx_products_category_status created in 001)
ALTER TABLE marketplace.products DROP COLUMN category CASCADE;

-- Add new columns
ALTER TABLE marketplace.products
    ADD COLUMN category_id      UUID REFERENCES marketplace.categories(id),
    ADD COLUMN availability_type TEXT NOT NULL DEFAULT 'for_sale'
                                    CHECK (availability_type IN (
                                        'for_sale',
                                        'hire',
                                        'lease',
                                        'bareboat_charter',
                                        'time_charter'
                                    ));

COMMENT ON COLUMN marketplace.products.category_id IS
    'FK to marketplace.categories. Replaces the old rigid text category column.';
COMMENT ON COLUMN marketplace.products.availability_type IS
    'For Sale | Hire | Lease | Bareboat Charter | Time Charter';


-- ── 6. Seed: Categories ───────────────────────────────────────────────────────
-- Uses a DO block with local variables to maintain parent→child FK relationships.
-- All slugs are kebab-case, globally unique at root level.

DO $$
DECLARE
    -- Root category IDs
    c_vessels           UUID;
    c_offshore_subsea   UUID;
    c_drilling          UUID;
    c_machinery         UUID;
    c_deck              UUID;
    c_pipelines         UUID;
    c_fuel              UUID;
    c_electrical        UUID;
    c_safety            UUID;
    c_mooring           UUID;
    c_shipyard          UUID;
    c_inspection        UUID;
    c_environmental     UUID;
    c_ict               UUID;
    c_spares            UUID;
    c_rental            UUID;
    c_training          UUID;

    -- Dummy UUID for seed attribution (system actor)
    system_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN

-- ── Root Category 1: Vessels & Floating Assets ────────────────────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Vessels & Floating Assets', 'vessels-floating-assets', 1)
    RETURNING id INTO c_vessels;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Offshore Support Vessels (OSV)',          'offshore-support-vessels',         c_vessels, 1),
    ('Platform Supply Vessels (PSV)',           'platform-supply-vessels',          c_vessels, 2),
    ('Anchor Handling Tug Supply (AHTS)',       'anchor-handling-tug-supply',       c_vessels, 3),
    ('Tugboats & Push Tugs',                    'tugboats-push-tugs',               c_vessels, 4),
    ('Barges',                                  'barges',                           c_vessels, 5),
    ('Crew Boats & Fast Supply Vessels',        'crew-boats-fast-supply',           c_vessels, 6),
    ('Workboats & Utility Vessels',             'workboats-utility-vessels',        c_vessels, 7),
    ('Dredgers',                                'dredgers',                         c_vessels, 8),
    ('FPSO / FSO',                              'fpso-fso',                         c_vessels, 9),
    ('Jack-up Barges & Liftboats',              'jack-up-barges-liftboats',         c_vessels, 10),
    ('Floating Cranes & Heavy Lift Vessels',    'floating-cranes-heavy-lift',       c_vessels, 11),
    ('Patrol Boats & Security Vessels',         'patrol-boats-security-vessels',    c_vessels, 12);


-- ── Root Category 2: Offshore & Subsea Equipment ──────────────────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Offshore & Subsea Equipment', 'offshore-subsea-equipment', 2)
    RETURNING id INTO c_offshore_subsea;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Subsea Trees & Wellhead Equipment',   'subsea-trees-wellhead',            c_offshore_subsea, 1),
    ('Manifolds & Subsea Structures',       'manifolds-subsea-structures',      c_offshore_subsea, 2),
    ('ROVs & AUVs',                         'rovs-auvs',                        c_offshore_subsea, 3),
    ('Umbilicals, Risers & Flowlines',      'umbilicals-risers-flowlines',      c_offshore_subsea, 4),
    ('Subsea Valves & Connectors',          'subsea-valves-connectors',         c_offshore_subsea, 5),
    ('Pipeline Installation Equipment',     'pipeline-installation-equipment',  c_offshore_subsea, 6),
    ('Diving Support Systems',              'diving-support-systems',           c_offshore_subsea, 7),
    ('Hyperbaric Chambers',                 'hyperbaric-chambers',              c_offshore_subsea, 8),
    ('Saturation Diving Systems',           'saturation-diving-systems',        c_offshore_subsea, 9),
    ('Subsea Control Systems',              'subsea-control-systems',           c_offshore_subsea, 10);


-- ── Root Category 3: Drilling & Well Services Equipment ───────────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Drilling & Well Services Equipment', 'drilling-well-services', 3)
    RETURNING id INTO c_drilling;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Drilling Rigs',                           'drilling-rigs',                c_drilling, 1),
    ('Drill Pipes, Casings & Tubulars',         'drill-pipes-casings-tubulars', c_drilling, 2),
    ('Blowout Preventers (BOPs)',               'blowout-preventers-bops',      c_drilling, 3),
    ('Mud Pumps & Shale Shakers',               'mud-pumps-shale-shakers',      c_drilling, 4),
    ('Cementing Units',                         'cementing-units',              c_drilling, 5),
    ('Well Testing Equipment',                  'well-testing-equipment',       c_drilling, 6),
    ('Coiled Tubing Units',                     'coiled-tubing-units',          c_drilling, 7),
    ('Wireline & Slickline Equipment',          'wireline-slickline-equipment', c_drilling, 8),
    ('Directional Drilling Tools (MWD/LWD)',    'directional-drilling-tools',   c_drilling, 9);


-- ── Root Category 4: Marine Machinery & Propulsion Systems ───────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Marine Machinery & Propulsion Systems', 'marine-machinery-propulsion', 4)
    RETURNING id INTO c_machinery;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Main Engines',                            'main-engines',                 c_machinery, 1),
    ('Auxiliary Engines & Generators',          'auxiliary-engines-generators', c_machinery, 2),
    ('Propellers & Thrusters',                  'propellers-thrusters',         c_machinery, 3),
    ('Gearboxes & Shafting Systems',            'gearboxes-shafting-systems',   c_machinery, 4),
    ('Steering Gear Systems',                   'steering-gear-systems',        c_machinery, 5),
    ('Dynamic Positioning (DP) Systems',        'dynamic-positioning-systems',  c_machinery, 6),
    ('Pumps',                                   'pumps',                        c_machinery, 7),
    ('Compressors & Air Systems',               'compressors-air-systems',      c_machinery, 8);


-- ── Root Category 5: Deck Equipment & Cargo Handling ─────────────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Deck Equipment & Cargo Handling', 'deck-equipment-cargo-handling', 5)
    RETURNING id INTO c_deck;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Cranes',                          'cranes',                   c_deck, 1),
    ('Winches',                         'winches',                  c_deck, 2),
    ('Capstans & Windlasses',           'capstans-windlasses',      c_deck, 3),
    ('Fairleads & Bollards',            'fairleads-bollards',        c_deck, 4),
    ('Lifting Slings & Shackles',       'lifting-slings-shackles',  c_deck, 5),
    ('Spreader Bars',                   'spreader-bars',            c_deck, 6),
    ('Forklifts & Reach Stackers',      'forklifts-reach-stackers', c_deck, 7),
    ('Cargo Securing Equipment',        'cargo-securing-equipment', c_deck, 8);


-- ── Root Category 6: Pipelines, Flow Control & Process Equipment ──────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Pipelines, Flow Control & Process Equipment', 'pipelines-flow-control-process', 6)
    RETURNING id INTO c_pipelines;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Pipes & Fittings',                    'pipes-fittings',               c_pipelines, 1),
    ('Valves',                              'valves',                       c_pipelines, 2),
    ('Flanges & Gaskets',                   'flanges-gaskets',              c_pipelines, 3),
    ('Pressure Vessels',                    'pressure-vessels',             c_pipelines, 4),
    ('Heat Exchangers',                     'heat-exchangers',              c_pipelines, 5),
    ('Separators',                          'separators',                   c_pipelines, 6),
    ('Process Pumps',                       'process-pumps',                c_pipelines, 7),
    ('Metering & Measurement Skids',        'metering-measurement-skids',   c_pipelines, 8);


-- ── Root Category 7: Fuel, Bunkering & Storage Systems ───────────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Fuel, Bunkering & Storage Systems', 'fuel-bunkering-storage', 7)
    RETURNING id INTO c_fuel;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Bunkering Systems',           'bunkering-systems',        c_fuel, 1),
    ('Fuel Transfer Pumps',         'fuel-transfer-pumps',      c_fuel, 2),
    ('Flow Meters',                 'flow-meters',              c_fuel, 3),
    ('Storage Tanks',               'storage-tanks',            c_fuel, 4),
    ('Hoses & Couplings',           'hoses-couplings',          c_fuel, 5),
    ('Fuel Treatment Systems',      'fuel-treatment-systems',   c_fuel, 6),
    ('Lubrication Systems',         'lubrication-systems',      c_fuel, 7),
    ('Blending Units',              'blending-units',           c_fuel, 8);


-- ── Root Category 8: Electrical, Instrumentation & Automation ────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Electrical, Instrumentation & Automation', 'electrical-instrumentation-automation', 8)
    RETURNING id INTO c_electrical;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Switchboards & Panels',               'switchboards-panels',          c_electrical, 1),
    ('Transformers',                        'transformers',                 c_electrical, 2),
    ('UPS & Power Management Systems',      'ups-power-management',         c_electrical, 3),
    ('PLC & SCADA Systems',                 'plc-scada-systems',            c_electrical, 4),
    ('Sensors & Transmitters',              'sensors-transmitters',         c_electrical, 5),
    ('Control Valves & Actuators',          'control-valves-actuators',     c_electrical, 6),
    ('Fire & Gas Detection Systems',        'fire-gas-detection-systems',   c_electrical, 7),
    ('Navigation Electronics',              'navigation-electronics',       c_electrical, 8);


-- ── Root Category 9: Safety, Firefighting & Emergency Equipment ───────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Safety, Firefighting & Emergency Equipment', 'safety-firefighting-emergency', 9)
    RETURNING id INTO c_safety;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Life Boats & Rescue Boats',               'life-boats-rescue-boats',          c_safety, 1),
    ('Life Rafts & Immersion Suits',            'life-rafts-immersion-suits',        c_safety, 2),
    ('Fire Pumps & Foam Systems',               'fire-pumps-foam-systems',          c_safety, 3),
    ('Fixed Fire Suppression Systems',          'fixed-fire-suppression',           c_safety, 4),
    ('Portable Fire Extinguishers',             'portable-fire-extinguishers',      c_safety, 5),
    ('Gas Detectors',                           'gas-detectors',                    c_safety, 6),
    ('Personal Protective Equipment (PPE)',     'personal-protective-equipment',    c_safety, 7),
    ('Emergency Escape & Breathing Devices',    'emergency-escape-breathing-eebd',  c_safety, 8);


-- ── Root Category 10: Mooring, Anchoring & Station Keeping ───────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Mooring, Anchoring & Station Keeping', 'mooring-anchoring-station-keeping', 10)
    RETURNING id INTO c_mooring;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Anchors',                         'anchors',                      c_mooring, 1),
    ('Mooring Chains & Wires',          'mooring-chains-wires',         c_mooring, 2),
    ('Shackles & Connectors',           'mooring-shackles-connectors',  c_mooring, 3),
    ('Buoys & Fender Systems',          'buoys-fender-systems',         c_mooring, 4),
    ('Chain Lockers & Accessories',     'chain-lockers-accessories',    c_mooring, 5),
    ('Tensioners & Mooring Winches',    'tensioners-mooring-winches',   c_mooring, 6);


-- ── Root Category 11: Shipyard, Fabrication & Construction Equipment ──────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Shipyard, Fabrication & Construction Equipment', 'shipyard-fabrication-construction', 11)
    RETURNING id INTO c_shipyard;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Welding Machines & Consumables',      'welding-machines-consumables',     c_shipyard, 1),
    ('Cutting Equipment',                   'cutting-equipment',                c_shipyard, 2),
    ('CNC Machines',                        'cnc-machines',                     c_shipyard, 3),
    ('Steel Plates & Structural Profiles',  'steel-plates-structural-profiles', c_shipyard, 4),
    ('Painting & Coating Equipment',        'painting-coating-equipment',       c_shipyard, 5),
    ('Blasting Machines',                   'blasting-machines',                c_shipyard, 6),
    ('Scaffolding Systems',                 'scaffolding-systems',              c_shipyard, 7);


-- ── Root Category 12: Inspection, Survey & Testing Equipment ─────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Inspection, Survey & Testing Equipment', 'inspection-survey-testing', 12)
    RETURNING id INTO c_inspection;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('NDT Equipment',               'ndt-equipment',                c_inspection, 1),
    ('Thickness Gauges',            'thickness-gauges',             c_inspection, 2),
    ('Corrosion Monitoring Tools',  'corrosion-monitoring-tools',   c_inspection, 3),
    ('Survey Drones',               'survey-drones',                c_inspection, 4),
    ('Load Testing Equipment',      'load-testing-equipment',       c_inspection, 5),
    ('Calibration Tools',           'calibration-tools',            c_inspection, 6),
    ('Sampling Equipment',          'sampling-equipment',           c_inspection, 7);


-- ── Root Category 13: Environmental & Waste Management Systems ───────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Environmental & Waste Management Systems', 'environmental-waste-management', 13)
    RETURNING id INTO c_environmental;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Oily Water Separators',               'oily-water-separators',            c_environmental, 1),
    ('Ballast Water Treatment Systems',     'ballast-water-treatment',          c_environmental, 2),
    ('Waste Incinerators',                  'waste-incinerators',               c_environmental, 3),
    ('Sludge Treatment Units',              'sludge-treatment-units',           c_environmental, 4),
    ('Spill Response Equipment',            'spill-response-equipment',         c_environmental, 5),
    ('Oil Skimmers & Booms',                'oil-skimmers-booms',               c_environmental, 6),
    ('Environmental Monitoring Sensors',    'environmental-monitoring-sensors', c_environmental, 7);


-- ── Root Category 14: ICT, Digital & Marine Technology ───────────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('ICT, Digital & Marine Technology', 'ict-digital-marine-technology', 14)
    RETURNING id INTO c_ict;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Fleet Management Systems',            'fleet-management-systems',         c_ict, 1),
    ('CMMS & Asset Management Software',    'cmms-asset-management-software',   c_ict, 2),
    ('Voyage Optimization Tools',           'voyage-optimization-tools',        c_ict, 3),
    ('Maritime Cybersecurity Solutions',    'maritime-cybersecurity-solutions', c_ict, 4),
    ('AI & Predictive Maintenance Tools',   'ai-predictive-maintenance-tools',  c_ict, 5),
    ('Communication Systems (VSAT/SATCOM)', 'communication-systems-vsat',       c_ict, 6);


-- ── Root Category 15: Spare Parts & Consumables ──────────────────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Spare Parts & Consumables', 'spare-parts-consumables', 15)
    RETURNING id INTO c_spares;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Engine Spares',           'engine-spares',            c_spares, 1),
    ('Pump & Valve Spares',     'pump-valve-spares',        c_spares, 2),
    ('Filters & Seals',         'filters-seals',            c_spares, 3),
    ('Bearings & Gaskets',      'bearings-gaskets',         c_spares, 4),
    ('Electrical Spares',       'electrical-spares',        c_spares, 5),
    ('Lubricants & Chemicals',  'lubricants-chemicals',     c_spares, 6),
    ('Welding Consumables',     'welding-consumables',      c_spares, 7);


-- ── Root Category 16: Temporary, Rental & Project-Based Equipment ─────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Temporary, Rental & Project-Based Equipment', 'temporary-rental-project-equipment', 16)
    RETURNING id INTO c_rental;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Power Generators',                'power-generators',                 c_rental, 1),
    ('Temporary Accommodation Units',   'temporary-accommodation-units',    c_rental, 2),
    ('Portable Tanks',                  'portable-tanks',                   c_rental, 3),
    ('Mobile Cranes',                   'mobile-cranes',                    c_rental, 4),
    ('Temporary Pipelines & Hoses',     'temporary-pipelines-hoses',        c_rental, 5),
    ('Lighting Towers',                 'lighting-towers',                  c_rental, 6);


-- ── Root Category 17: Training, Services & Human Capital ─────────────────────
INSERT INTO marketplace.categories (name, slug, display_order)
    VALUES ('Training, Services & Human Capital', 'training-services-human-capital', 17)
    RETURNING id INTO c_training;

INSERT INTO marketplace.categories (name, slug, parent_id, display_order) VALUES
    ('Crew Training Simulators',                'crew-training-simulators',             c_training, 1),
    ('Offshore Safety Training Equipment',      'offshore-safety-training-equipment',   c_training, 2),
    ('Manning & Crew Supply',                   'manning-crew-supply',                  c_training, 3),
    ('Marine Consultancy Services',             'marine-consultancy-services',          c_training, 4),
    ('Inspection & Certification Services',     'inspection-certification-services',    c_training, 5),
    ('Maintenance & Repair Services',           'maintenance-repair-services',          c_training, 6);

END;
$$ LANGUAGE plpgsql;


-- ── 7. Seed: Global Attribute Definitions ────────────────────────────────────
-- These apply to all product types. Agents/admins can create additional
-- category-specific attributes via the API.
--
-- Uses a seed profile ID of '00000000-0000-0000-0000-000000000001' (system seed actor).
-- IMPORTANT: Insert a placeholder profile row if it does not exist, or replace
-- '00000000-0000-0000-0000-000000000001' with a real admin UUID after first admin signup.

DO $$
DECLARE
    -- We need a valid profile ID for created_by.
    -- Use the first admin profile found, or fall back to a known placeholder.
    seed_actor UUID;
BEGIN
    -- Try to find an existing admin to attribute seed data to
    SELECT id INTO seed_actor
    FROM public.profiles
    WHERE 'admin' = ANY(roles)
    ORDER BY created_at ASC
    LIMIT 1;

    IF seed_actor IS NULL THEN
        -- No admin exists yet — insert a system placeholder profile.
        -- This will be cleaned up or linked to a real admin later.
        -- NOTE: This requires a matching auth.users entry to satisfy the FK.
        -- If that doesn't exist, run after creating your first admin account,
        -- replacing this seed with the real admin UUID.
        RAISE NOTICE
            'No admin profile found. Attribute seed data will be skipped. '
            'Run the attribute seed manually after creating the first admin account.';
        RETURN;
    END IF;

    -- ── Universal attributes (apply to all categories) ─────────────────────
    INSERT INTO marketplace.attributes
        (name, slug, data_type, unit, category_id, display_order, created_by)
    VALUES
        ('Manufacturer',            'manufacturer',         'text',    NULL,       NULL, 1,  seed_actor),
        ('Model',                   'model',                'text',    NULL,       NULL, 2,  seed_actor),
        ('Year Manufactured',       'year-manufactured',    'numeric', NULL,       NULL, 3,  seed_actor),
        ('Country of Origin',       'country-of-origin',    'text',    NULL,       NULL, 4,  seed_actor),
        ('Condition',               'condition',            'text',    NULL,       NULL, 5,  seed_actor),
        ('Serial Number',           'serial-number',        'text',    NULL,       NULL, 6,  seed_actor),
        ('Certification Status',    'certification-status', 'text',    NULL,       NULL, 7,  seed_actor),
        ('Classification Society',  'classification-society','text',   NULL,       NULL, 8,  seed_actor),
        ('Inspection History',      'inspection-history',   'text',    NULL,       NULL, 9,  seed_actor),
        ('Weight',                  'weight',               'numeric', 'tonnes',   NULL, 10, seed_actor),
        ('Length',                  'length',               'numeric', 'm',        NULL, 11, seed_actor),
        ('Width',                   'width',                'numeric', 'm',        NULL, 12, seed_actor),
        ('Height',                  'height',               'numeric', 'm',        NULL, 13, seed_actor),
        ('Power Rating',            'power-rating',         'numeric', 'kW',       NULL, 14, seed_actor),
        ('Operating Hours',         'operating-hours',      'numeric', 'hours',    NULL, 15, seed_actor),
        ('Last Inspection Date',    'last-inspection-date', 'date',    NULL,       NULL, 16, seed_actor),
        ('Flag State',              'flag-state',           'text',    NULL,       NULL, 17, seed_actor),
        ('IMO Number',              'imo-number',           'text',    NULL,       NULL, 18, seed_actor);

    RAISE NOTICE 'Attribute seed complete. Created by admin: %', seed_actor;
END;
$$ LANGUAGE plpgsql;


-- ── 8. Indexes ────────────────────────────────────────────────────────────────

-- Categories
CREATE INDEX idx_categories_parent_id
    ON marketplace.categories(parent_id)
    WHERE parent_id IS NOT NULL;

CREATE INDEX idx_categories_active
    ON marketplace.categories(display_order)
    WHERE is_active = TRUE AND parent_id IS NULL;

-- Products (replace dropped index from 001)
CREATE INDEX idx_products_category_id_status
    ON marketplace.products(category_id, status)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_products_availability_type
    ON marketplace.products(availability_type, status)
    WHERE deleted_at IS NULL AND status = 'active';

-- Product contacts
CREATE INDEX idx_product_contacts_product_id
    ON marketplace.product_contacts(product_id);

-- Attribute values
CREATE INDEX idx_attribute_values_product_id
    ON marketplace.product_attribute_values(product_id);

CREATE INDEX idx_attribute_values_attribute_id
    ON marketplace.product_attribute_values(attribute_id);

-- Attributes
CREATE INDEX idx_attributes_category_id
    ON marketplace.attributes(category_id)
    WHERE category_id IS NOT NULL;


-- ── 9. RLS: New Tables ────────────────────────────────────────────────────────

-- Categories: public read, admin write
ALTER TABLE marketplace.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_active_categories" ON marketplace.categories
    FOR SELECT USING (is_active = TRUE);

CREATE POLICY "admin_manage_categories" ON marketplace.categories
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND 'admin' = ANY(p.roles)
        )
    );


-- Product contacts: seller sees own, agents and admins see all
ALTER TABLE marketplace.product_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seller_own_product_contacts" ON marketplace.product_contacts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM marketplace.products mp
            WHERE mp.id = product_id AND mp.seller_id = auth.uid()
        )
    );

CREATE POLICY "agent_read_product_contacts" ON marketplace.product_contacts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND (
                'verification_agent' = ANY(p.roles)
                OR 'buyer_agent' = ANY(p.roles)
                OR 'admin' = ANY(p.roles)
            )
        )
    );

CREATE POLICY "admin_manage_product_contacts" ON marketplace.product_contacts
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND 'admin' = ANY(p.roles)
        )
    );


-- Attributes: public read for active ones, agents/admins can create
ALTER TABLE marketplace.attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_active_attributes" ON marketplace.attributes
    FOR SELECT USING (is_active = TRUE);

CREATE POLICY "agent_admin_manage_attributes" ON marketplace.attributes
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND (
                'verification_agent' = ANY(p.roles)
                OR 'admin' = ANY(p.roles)
            )
        )
    );

CREATE POLICY "admin_update_attributes" ON marketplace.attributes
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND 'admin' = ANY(p.roles)
        )
    );


-- Product attribute values: seller sees own, agents/admins see all, agents/admins can write
ALTER TABLE marketplace.product_attribute_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seller_read_own_attribute_values" ON marketplace.product_attribute_values
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM marketplace.products mp
            WHERE mp.id = product_id AND mp.seller_id = auth.uid()
        )
    );

CREATE POLICY "public_read_published_attribute_values" ON marketplace.product_attribute_values
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM marketplace.products mp
            WHERE mp.id = product_id AND mp.status = 'active' AND mp.deleted_at IS NULL
        )
    );

CREATE POLICY "agent_admin_manage_attribute_values" ON marketplace.product_attribute_values
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND (
                'verification_agent' = ANY(p.roles)
                OR 'admin' = ANY(p.roles)
            )
        )
    );
