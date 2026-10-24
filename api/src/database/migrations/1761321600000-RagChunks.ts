import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tables for RAG, written by the agents service (Python). The vector size (1536) must match
 * EMBEDDING_DIMENSIONS; changing the embedding model or size means a new migration and a full re-index.
 */
export class RagChunks1761321600000 implements MigrationInterface {
  name = 'RagChunks1761321600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // RAG 1: pieces of each site's code, so agents can find "the testimonials section" by meaning.
    await queryRunner.query(`
      CREATE TABLE code_chunks (
        id bigserial PRIMARY KEY,
        site_id text NOT NULL REFERENCES sites (id),
        strategy text NOT NULL CHECK (strategy IN ('contextual', 'component', 'fixed')),
        file_path text NOT NULL,
        chunk_index integer NOT NULL,
        kind text NOT NULL CHECK (kind IN ('page', 'component', 'layout', 'data', 'style', 'config', 'other')),
        title text NOT NULL,
        context text NOT NULL,
        content text NOT NULL,
        content_hash text NOT NULL,
        embedding vector(1536) NOT NULL,
        embedding_model text NOT NULL,
        search_vector tsvector GENERATED ALWAYS AS (
          to_tsvector('english', title || ' ' || context || ' ' || content)
        ) STORED,
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (site_id, strategy, file_path, chunk_index)
      )
    `);

    // RAG 2: what we know about each client (brand guide, contracted plan, past tickets).
    await queryRunner.query(`
      CREATE TABLE knowledge_chunks (
        id bigserial PRIMARY KEY,
        client_id uuid NOT NULL REFERENCES clients (id),
        source_type text NOT NULL CHECK (source_type IN ('brand_guide', 'plan', 'past_ticket')),
        source_title text NOT NULL,
        source_path text NOT NULL,
        chunk_index integer NOT NULL,
        heading text NOT NULL,
        content text NOT NULL,
        content_hash text NOT NULL,
        embedding vector(1536) NOT NULL,
        embedding_model text NOT NULL,
        search_vector tsvector GENERATED ALWAYS AS (
          to_tsvector('english', source_title || ' ' || heading || ' ' || content)
        ) STORED,
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (client_id, source_path, chunk_index)
      )
    `);

    // Approximate nearest-neighbour indexes (HNSW) for cosine distance, and GIN indexes for full-text search.
    await queryRunner.query(`CREATE INDEX code_chunks_embedding_idx ON code_chunks USING hnsw (embedding vector_cosine_ops)`);
    await queryRunner.query(`CREATE INDEX code_chunks_search_idx ON code_chunks USING gin (search_vector)`);
    await queryRunner.query(`CREATE INDEX code_chunks_site_idx ON code_chunks (site_id, strategy)`);
    await queryRunner.query(
      `CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)`,
    );
    await queryRunner.query(`CREATE INDEX knowledge_chunks_search_idx ON knowledge_chunks USING gin (search_vector)`);
    await queryRunner.query(`CREATE INDEX knowledge_chunks_client_idx ON knowledge_chunks (client_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE knowledge_chunks`);
    await queryRunner.query(`DROP TABLE code_chunks`);
  }
}
