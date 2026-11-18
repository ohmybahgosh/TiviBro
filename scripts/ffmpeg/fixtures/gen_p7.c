/* Test only: Dolby Vision profile 7 style RPUs (enhancement layer in use: residual on, NLQ linear deadzone,
   a non-identity polynomial mapping), made with ffmpeg's own RPU writer.  Writes N NAL payloads (each starting
   with the 0x19 prefix), each preceded by a 4-byte big-endian length. */
#include <stdio.h>
#include <string.h>
#include "libavcodec/dovi_rpu.h"
#include "libavutil/dovi_meta.h"
#include "libavutil/mem.h"
int main(int argc, char **argv) {
    int n = argc > 1 ? atoi(argv[1]) : 48;
    DOVIContext s; memset(&s, 0, sizeof(s));
    s.enable = 1;
    s.cfg.dv_version_major = 1; s.cfg.dv_profile = 7; s.cfg.dv_level = 6; s.cfg.rpu_present_flag = 1; s.cfg.el_present_flag = 1; s.cfg.bl_present_flag = 1; s.cfg.dv_bl_signal_compatibility_id = 6;
    for (int f = 0; f < n; f++) {
        size_t sz; AVDOVIMetadata *m = av_dovi_metadata_alloc(&sz);
        AVDOVIRpuDataHeader *h = av_dovi_get_header(m);
        AVDOVIDataMapping *mp = av_dovi_get_mapping(m);
        AVDOVIColorMetadata *c = av_dovi_get_color(m);
        h->rpu_type = 2; h->rpu_format = 18; h->vdr_rpu_profile = 1; h->vdr_rpu_level = 0;
        h->coef_data_type = 0; h->coef_log2_denom = 23; h->vdr_rpu_normalized_idc = 1;
        h->bl_bit_depth = 10; h->el_bit_depth = 10; h->vdr_bit_depth = 12;
        h->disable_residual_flag = 0; h->el_spatial_resampling_filter_flag = 1;
        mp->vdr_rpu_id = 0;
        for (int k = 0; k < 3; k++) {
            AVDOVIReshapingCurve *cv = &mp->curves[k];
            cv->num_pivots = 3; cv->pivots[0] = 0; cv->pivots[1] = 512; cv->pivots[2] = 1023;
            for (int p = 0; p < 2; p++) { cv->mapping_idc[p] = AV_DOVI_MAPPING_POLYNOMIAL; cv->poly_order[p] = 2; cv->poly_coef[p][0] = 1 << 20; cv->poly_coef[p][1] = (1LL << 23) + 12345; cv->poly_coef[p][2] = -(1 << 18); }
        }
        mp->nlq_method_idc = AV_DOVI_NLQ_LINEAR_DZ; mp->num_x_partitions = 1; mp->num_y_partitions = 1;
        mp->nlq_pivots[0] = 0; mp->nlq_pivots[1] = 1023;
        for (int k = 0; k < 3; k++) { mp->nlq[k].nlq_offset = 512; mp->nlq[k].vdr_in_max = 1LL << 23; mp->nlq[k].linear_deadzone_slope = 1LL << 22; mp->nlq[k].linear_deadzone_threshold = 1 << 10; }
        /* L0 colour metadata and an L1 block (the dynamic metadata a TV uses) */
        c->dm_metadata_id = 0; c->scene_refresh_flag = f == 0;
        for (int i = 0; i < 9; i++) { c->ycc_to_rgb_matrix[i] = av_make_q(i % 4 == 0 ? 8192 : 0, 8192); c->rgb_to_lms_matrix[i] = av_make_q(i % 4 == 0 ? 16384 : 0, 16384); }
        for (int i = 0; i < 3; i++) c->ycc_to_rgb_offset[i] = av_make_q(1 << 28, 1 << 28);
        c->signal_eotf = 65535; c->signal_bit_depth = 12; c->signal_color_space = 0; c->signal_chroma_format = 0; c->source_min_pq = 62; c->source_max_pq = 3696; c->source_diagonal = 42;
        m->num_ext_blocks = 2; /* allocated with room for ext blocks */
        AVDOVIDmData *dm = av_dovi_get_ext(m, 0); dm->level = 1; dm->l1.min_pq = 10; dm->l1.max_pq = 2000 + f; dm->l1.avg_pq = 800;
        /* L5: the letterbox of a full 2160-line frame (what a disc's RPU says, kept in a cropped remux) */
        AVDOVIDmData *d5 = av_dovi_get_ext(m, 1); d5->level = 5; d5->l5.top_offset = 278; d5->l5.bottom_offset = 278;
        uint8_t *out; int size;
        if (ff_dovi_rpu_generate(&s, m, FF_DOVI_WRAP_NAL, &out, &size) < 0) { fprintf(stderr, "generate failed\n"); return 1; }
        unsigned char len[4] = { size >> 24, size >> 16, size >> 8, size }; fwrite(len, 1, 4, stdout); fwrite(out, 1, size, stdout);
        av_free(out); av_free(m);
    }
    return 0;
}
