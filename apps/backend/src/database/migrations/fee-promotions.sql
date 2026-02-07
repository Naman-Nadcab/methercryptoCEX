-- Fee promotions: time-bound fee discounts (spot maker/taker, withdrawal, p2p)
CREATE TABLE IF NOT EXISTS fee_promotions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    promotion_type VARCHAR(50) NOT NULL CHECK (promotion_type IN ('spot_maker', 'spot_taker', 'spot_both', 'withdrawal', 'p2p_maker', 'p2p_taker')),
    discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed_rate')),
    discount_value DECIMAL(10,6) NOT NULL,
    min_volume_30d DECIMAL(30,8) DEFAULT 0,
    applicable_tier_levels INT[] DEFAULT NULL,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fee_promotions_type ON fee_promotions(promotion_type);
CREATE INDEX IF NOT EXISTS idx_fee_promotions_dates ON fee_promotions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_fee_promotions_active ON fee_promotions(is_active) WHERE is_active = TRUE;
