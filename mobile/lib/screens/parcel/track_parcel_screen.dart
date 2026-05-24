import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procolis/screens/parcel/parcel_detail_screen.dart';

import '../../models/parcel.dart';
import '../../providers/parcel_provider.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class TrackParcelScreen extends ConsumerStatefulWidget {
  const TrackParcelScreen({super.key});

  @override
  ConsumerState<TrackParcelScreen> createState() => _TrackParcelScreenState();
}

class _TrackParcelScreenState extends ConsumerState<TrackParcelScreen> {
  final _trackingController = TextEditingController();
  bool _isSearching = false;
  Parcel? _trackedParcel;

  Future<void> _trackParcel() async {
    final trackingNumber = _trackingController.text.trim();
    if (trackingNumber.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Veuillez entrer un numéro de suivi')),
      );
      return;
    }
    
    setState(() => _isSearching = true);
    
    try {
      final parcel = await ref.read(parcelProvider.notifier).trackParcel(trackingNumber);
      setState(() {
        _isSearching = false;
        _trackedParcel = parcel;
      });
      
      if (parcel == null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Colis non trouvé'), backgroundColor: Colors.red),
        );
      }
    } catch (e) {
      setState(() => _isSearching = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erreur: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  // Vérifier si une étape est complétée
  bool _isStepCompleted(Parcel parcel, String stepStatus) {
    final statusOrder = [
      'pending',
      'confirmed', 
      'picked_up',
      'in_transit',
      'arrived',
      'out_for_delivery',
      'delivered'
    ];
    
    final currentIndex = statusOrder.indexOf(parcel.status.value);
    final stepIndex = statusOrder.indexOf(stepStatus);
    
    return currentIndex >= stepIndex;
  }

  Widget _buildStatusTimeline(Parcel parcel) {
    const steps = [
      {'status': 'pending', 'label': 'Création', 'icon': Icons.create},
      {'status': 'confirmed', 'label': 'Confirmé', 'icon': Icons.check_circle},
      {'status': 'picked_up', 'label': 'Ramassé', 'icon': Icons.local_shipping},
      {'status': 'in_transit', 'label': 'En transit', 'icon': Icons.transfer_within_a_station},
      {'status': 'arrived', 'label': 'Arrivé', 'icon': Icons.location_on},
      {'status': 'out_for_delivery', 'label': 'En livraison', 'icon': Icons.delivery_dining},
      {'status': 'delivered', 'label': 'Livré', 'icon': Icons.check_circle},
    ];

    return Column(
      children: steps.asMap().entries.map((entry) {
        final index = entry.key;
        final step = entry.value;
        final isCompleted = _isStepCompleted(parcel, step['status'] as String);
        final isLast = index == steps.length - 1;
        final isCurrent = parcel.status.value == step['status'];
        
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isCompleted ? const Color(0xFF0B6E3A) : Colors.grey.shade300,
                  ),
                  child: Icon(step['icon'] as IconData, color: Colors.white, size: 20),
                ),
                if (!isLast)
                  Container(
                    width: 2,
                    height: 60,
                    color: isCompleted ? const Color(0xFF0B6E3A) : Colors.grey.shade300,
                  ),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(bottom: isLast ? 0 : 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      step['label'] as String,
                      style: TextStyle(
                        fontWeight: isCompleted ? FontWeight.bold : FontWeight.normal,
                        color: isCompleted ? const Color(0xFF0B6E3A) : Colors.grey,
                      ),
                    ),
                    if (isCurrent)
                      const Text(
                        'En cours',
                        style: TextStyle(fontSize: 12, color: Color(0xFF0B6E3A)),
                      ),
                    if (step['status'] == 'delivered' && parcel.deliveryDate != null)
                      Text(
                        _formatDate(parcel.deliveryDate!),
                        style: const TextStyle(fontSize: 11, color: Colors.grey),
                      ),
                  ],
                ),
              ),
            ),
          ],
        );
      }).toList(),
    );
  }

  String _formatDate(DateTime date) {
    return '${date.day}/${date.month}/${date.year} à ${date.hour}:${date.minute.toString().padLeft(2, '0')}';
  }

  void _viewFullDetails() {
    if (_trackedParcel != null && mounted) {
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => ParcelDetailScreen(parcel: _trackedParcel!),
        ),
      );
    }
  }

  void _shareTrackingNumber() {
    if (_trackedParcel != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Partager: ${_trackedParcel!.trackingNumber}'), backgroundColor: Colors.blue),
      );
    }
  }

  void _downloadReceipt() {
    if (_trackedParcel != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Téléchargement du reçu en cours...'), backgroundColor: Colors.blue),
      );
    }
  }

  void _makePhoneCall(String phoneNumber) {
    if (phoneNumber.isNotEmpty) {
      debugPrint('Appel vers: $phoneNumber');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Suivre un colis'),
        backgroundColor: const Color(0xFF0B6E3A),
        foregroundColor: Colors.white,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            // Recherche
            Card(
              elevation: 2,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    CustomTextField(
                      controller: _trackingController,
                      label: 'Numéro de suivi',
                      prefixIcon: Icons.search,
                      hint: 'Ex: COL-20260519-0105A7',
                    ),
                    const SizedBox(height: 16),
                    CustomButton(
                      text: 'Suivre mon colis',
                      onPressed: _trackParcel,
                      isLoading: _isSearching,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            
            // Résultat
            if (_trackedParcel != null) ...[
              Card(
                elevation: 2,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _trackedParcel!.trackingNumber,
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                  fontFamily: 'monospace',
                                ),
                              ),
                              const SizedBox(height: 4),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: _trackedParcel!.status.color.withAlpha(25),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Text(
                                  _trackedParcel!.status.label,
                                  style: TextStyle(fontSize: 12, color: _trackedParcel!.status.color),
                                ),
                              ),
                            ],
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              if (_trackedParcel!.price != null) ...[
                                const Text('Montant', style: TextStyle(fontSize: 12, color: Colors.grey)),
                                Text(
                                  _trackedParcel!.formattedPrice,
                                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF0B6E3A)),
                                ),
                              ],
                              if (_trackedParcel!.isUrgent)
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: Colors.red.withAlpha(25),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Text(
                                    'URGENT',
                                    style: TextStyle(fontSize: 10, color: Colors.red, fontWeight: FontWeight.bold),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                      const Divider(height: 32),
                      
                      // Timeline
                      _buildStatusTimeline(_trackedParcel!),
                      const Divider(height: 32),
                      
                      // SECTION: EXPÉDITEUR
                      _buildSectionTitle('Expéditeur', Icons.person_outline),
                      _buildInfoRow('Nom', _trackedParcel!.senderName, Icons.person),
                      _buildInfoRow('Téléphone', _trackedParcel!.senderPhone, Icons.phone),
                      
                      const Divider(height: 16),
                      
                      // SECTION: DESTINATAIRE
                      _buildSectionTitle('Destinataire', Icons.person),
                      _buildInfoRow('Nom', _trackedParcel!.receiverName, Icons.person),
                      _buildInfoRow('Téléphone', _trackedParcel!.receiverPhone, Icons.phone),
                      if (_trackedParcel!.receiverEmail != null && _trackedParcel!.receiverEmail!.isNotEmpty)
                        _buildInfoRow('Email', _trackedParcel!.receiverEmail!, Icons.email),
                      if (_trackedParcel!.receiverAddress != null && _trackedParcel!.receiverAddress!.isNotEmpty)
                        _buildInfoRow('Adresse', _trackedParcel!.receiverAddress!, Icons.location_on),
                      
                      const Divider(height: 16),
                      
                      // SECTION: DÉTAILS DU COLIS
                      _buildSectionTitle('Détails du colis', Icons.inventory),
                      _buildInfoRow('Description', _trackedParcel!.description, Icons.description),
                      _buildInfoRow('Poids', _trackedParcel!.formattedWeight, Icons.fitness_center),
                      _buildInfoRow('Type', _trackedParcel!.type.label, Icons.category),
                      if (_trackedParcel!.length != null || _trackedParcel!.width != null || _trackedParcel!.height != null)
                        _buildInfoRow('Dimensions', _getDimensions(), Icons.crop),
                      if (_trackedParcel!.volume > 0)
                        _buildInfoRow('Volume', _trackedParcel!.formattedVolume, Icons.calculate),
                      
                      const Divider(height: 16),
                      
                      // SECTION: TRAJET
                      _buildSectionTitle('Trajet', Icons.route),
                      _buildInfoRow('Garage départ', _trackedParcel!.departureGarageName, Icons.departure_board),
                      if (_trackedParcel!.arrivalGarageName != null && _trackedParcel!.arrivalGarageName!.isNotEmpty)
                        _buildInfoRow('Garage arrivée', _trackedParcel!.arrivalGarageName!, Icons.location_on),
                      
                      const Divider(height: 16),
                      
                      // SECTION: CHAUFFEUR
                      if (_trackedParcel!.hasDriver) ...[
                        _buildSectionTitle('Chauffeur', Icons.delivery_dining),
                        if (_trackedParcel!.driverName != null)
                          _buildInfoRow('Nom', _trackedParcel!.driverName!, Icons.person),
                        if (_trackedParcel!.driverPhone != null)
                          Row(
                            children: [
                              Expanded(
                                child: _buildInfoRow('Téléphone', _trackedParcel!.driverPhone!, Icons.phone),
                              ),
                              IconButton(
                                icon: const Icon(Icons.call, color: Colors.green, size: 20),
                                onPressed: () => _makePhoneCall(_trackedParcel!.driverPhone!),
                              ),
                            ],
                          ),
                        const Divider(height: 16),
                      ],
                      
                      // SECTION: DATES
                      _buildSectionTitle('Dates importantes', Icons.calendar_today),
                      _buildInfoRow('Création', _formatDate(_trackedParcel!.createdAt), Icons.create),
                      if (_trackedParcel!.pickupDate != null)
                        _buildInfoRow('Ramassage', _formatDate(_trackedParcel!.pickupDate!), Icons.inventory),
                      if (_trackedParcel!.deliveryDate != null)
                        _buildInfoRow('Livraison', _formatDate(_trackedParcel!.deliveryDate!), Icons.check_circle),
                      if (_trackedParcel!.estimatedDeliveryDate != null)
                        _buildInfoRow('Estimée', _formatDate(_trackedParcel!.estimatedDeliveryDate!), Icons.schedule),
                      
                      const Divider(height: 16),
                      
                      // SECTION: OPTIONS
                      _buildSectionTitle('Options', Icons.settings),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _buildOptionChip('Urgent', _trackedParcel!.isUrgent, Colors.red),
                          _buildOptionChip('Assuré', _trackedParcel!.isInsured, Colors.blue),
                          _buildOptionChip('Payé', _trackedParcel!.isPaid, Colors.green),
                          _buildOptionChip('Chauffeur', _trackedParcel!.hasDriver, Colors.orange),
                          _buildOptionChip('En cours', _trackedParcel!.isInProgress, Colors.purple),
                          _buildOptionChip('Terminé', _trackedParcel!.isFinished, Colors.teal),
                        ],
                      ),
                      
                      // SECTION: PHOTOS
                      if (_trackedParcel!.photoUrls.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _buildSectionTitle('Photos', Icons.photo_library),
                        const SizedBox(height: 8),
                        SizedBox(
                          height: 100,
                          child: ListView.builder(
                            scrollDirection: Axis.horizontal,
                            itemCount: _trackedParcel!.photoUrls.length,
                            itemBuilder: (context, index) {
                              return _buildPhotoThumbnail(_trackedParcel!.photoUrls[index]);
                            },
                          ),
                        ),
                      ],
                      
                      // SECTION: NOTES
                      if (_trackedParcel!.notes != null && _trackedParcel!.notes!.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _buildSectionTitle('Notes', Icons.note),
                        Padding(
                          padding: const EdgeInsets.only(left: 36),
                          child: Text(
                            _trackedParcel!.notes!,
                            style: const TextStyle(fontSize: 13, fontStyle: FontStyle.italic),
                          ),
                        ),
                      ],
                      
                      const SizedBox(height: 16),
                      
                      // Bouton Voir tous les détails
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: _viewFullDetails,
                          icon: const Icon(Icons.visibility),
                          label: const Text('Voir tous les détails'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: const Color(0xFF0B6E3A),
                            side: const BorderSide(color: Color(0xFF0B6E3A)),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              
              const SizedBox(height: 16),
              
              // Actions
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _shareTrackingNumber,
                      icon: const Icon(Icons.share),
                      label: const Text('Partager'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF0B6E3A),
                        side: const BorderSide(color: Color(0xFF0B6E3A)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _downloadReceipt,
                      icon: const Icon(Icons.download),
                      label: const Text('Reçu'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF0B6E3A),
                        side: const BorderSide(color: Color(0xFF0B6E3A)),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  // ==================== WIDGETS PERSONNALISÉS ====================

  Widget _buildSectionTitle(String title, IconData icon, {Color? color}) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color ?? const Color(0xFF0B6E3A)),
          const SizedBox(width: 8),
          Text(
            title,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: color ?? const Color(0xFF0B6E3A),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoRow(String label, String value, IconData icon) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: Colors.grey.shade600),
          const SizedBox(width: 12),
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPhotoThumbnail(String url) {
    return GestureDetector(
      onTap: () {
        _showPhotoDialog(url);
      },
      child: Container(
        margin: const EdgeInsets.only(right: 8),
        width: 100,
        height: 100,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          image: DecorationImage(
            image: NetworkImage(url),
            fit: BoxFit.cover,
          ),
        ),
      ),
    );
  }

  void _showPhotoDialog(String url) {
    showDialog(
      context: context,
      builder: (context) => Dialog(
        child: Container(
          width: double.infinity,
          height: MediaQuery.of(context).size.height * 0.6,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            image: DecorationImage(
              image: NetworkImage(url),
              fit: BoxFit.contain,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildOptionChip(String label, bool isActive, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: isActive ? color.withAlpha(25) : Colors.grey.withAlpha(25),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isActive ? color : Colors.grey,
          width: 0.5,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isActive ? Icons.check_circle : Icons.circle_outlined,
            size: 14,
            color: isActive ? color : Colors.grey,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: isActive ? color : Colors.grey,
            ),
          ),
        ],
      ),
    );
  }

  String _getDimensions() {
    final parts = <String>[];
    if (_trackedParcel!.length != null) parts.add('L: ${_trackedParcel!.length} cm');
    if (_trackedParcel!.width != null) parts.add('l: ${_trackedParcel!.width} cm');
    if (_trackedParcel!.height != null) parts.add('H: ${_trackedParcel!.height} cm');
    return parts.join(' x ');
  }
}